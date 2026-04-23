/**
 * Shippo Fulfillment Module Provider.
 *
 * Wires Medusa v2's native fulfillment module into Shippo's multi-carrier
 * rate + label API. One provider instance serves six shipping options
 * (USPS Ground Advantage / Priority, UPS Ground / 2nd Day, FedEx Ground
 * / 2Day), each mapped to a Shippo `provider + servicelevel.token` pair.
 *
 * Weight/dims come directly off each cart line item's nested variant
 * (populated by Medusa when the cart is retrieved). Bundle variants
 * carry their own weight/dims too — seeded as `sum of component
 * weights` with the box sized to fit the largest component — so we
 * don't need cross-module query access from inside the provider.
 * Packing runs First-Fit Decreasing against a small set of pre-declared
 * box templates (see `packer.ts`).
 */

import { createHash } from "node:crypto";
import { AbstractFulfillmentProviderService } from "@medusajs/framework/utils";
import type {
  CalculateShippingOptionPriceDTO,
  CalculatedShippingOptionPrice,
  CreateFulfillmentResult,
  CreateShippingOptionDTO,
  FulfillmentDTO,
  FulfillmentItemDTO,
  FulfillmentOption,
  FulfillmentOrderDTO,
  Logger,
} from "@medusajs/framework/types";
import {
  ShippoClient,
  type ShippoAddress,
  type ShippoParcel,
  type ShippoRate,
  type ShippoShipment,
} from "./client";
import {
  BOX_TEMPLATES,
  ParcelTooLargeError,
  packUnitsIntoParcels,
  type ParcelUnit,
  type PackedParcel,
} from "./packer";

export type ShippoFromAddress = {
  name?: string;
  street1: string;
  street2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone?: string;
  email?: string;
};

export type ShippoProviderOptions = {
  apiKey: string;
  fromAddress: ShippoFromAddress;
  webhookSecret?: string;
  baseUrl?: string;
};

type InjectedDependencies = {
  logger: Logger;
};

/**
 * The six carrier + service combinations we expose to customers.
 * `id` is the fulfillment option id stored on each shipping option's
 * `data.id` — the same id is used to look up the `provider` +
 * `servicelevel` in Shippo's rate response.
 */
const SHIPPO_FULFILLMENT_OPTIONS: Array<
  FulfillmentOption & { carrier: string; servicelevel: string; label: string }
> = [
  {
    id: "usps__ground_advantage",
    carrier: "usps",
    servicelevel: "usps_ground_advantage",
    label: "USPS Ground Advantage",
  },
  {
    id: "usps__priority",
    carrier: "usps",
    servicelevel: "usps_priority",
    label: "USPS Priority Mail",
  },
  {
    id: "ups__ground",
    carrier: "ups",
    servicelevel: "ups_ground",
    label: "UPS Ground",
  },
  {
    id: "ups__2nd_day_air",
    carrier: "ups",
    servicelevel: "ups_2nd_day_air",
    label: "UPS 2nd Day Air",
  },
  {
    id: "fedex__ground",
    carrier: "fedex",
    servicelevel: "fedex_ground",
    label: "FedEx Ground",
  },
  {
    id: "fedex__2day",
    carrier: "fedex",
    servicelevel: "fedex_2_day",
    label: "FedEx 2Day",
  },
];

type ShippoOptionData = {
  id?: string;
  carrier?: string;
  servicelevel?: string;
};

type CartContext = CalculateShippingOptionPriceDTO["context"];

class ShippoFulfillmentProviderService extends AbstractFulfillmentProviderService {
  static identifier = "shippo";

  protected logger_: Logger;
  protected options_: ShippoProviderOptions;
  protected client_: ShippoClient;
  /**
   * Short-lived cache of Shippo shipment responses keyed by
   * `cart_id + items/address hash`. Purpose:
   *   1. Medusa invokes calculatePrice once per enabled shipping option
   *      (6x per cart refresh). A single Shippo POST /shipments/ call
   *      returns rates for every carrier, so caching lets us serve all
   *      six lookups from one API call.
   *   2. Shippo's sandbox is non-deterministic — back-to-back calls for
   *      the same shipment sometimes return only a partial carrier set
   *      or an empty rates array. Caching stabilises the user-facing
   *      price between the storefront's /calculate call and Medusa's
   *      re-invocation during addShippingMethod.
   */
  private shipmentCache_ = new Map<
    string,
    { shipment: ShippoShipment; expiresAt: number }
  >();
  private static readonly SHIPMENT_CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(deps: InjectedDependencies, options: ShippoProviderOptions) {
    super();
    this.logger_ = deps.logger;
    this.options_ = options;
    this.client_ = new ShippoClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
    });
  }

  async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
    return SHIPPO_FULFILLMENT_OPTIONS.map(({ id, carrier, servicelevel, label }) => ({
      id,
      carrier,
      servicelevel,
      label,
    }));
  }

  async canCalculate(data: CreateShippingOptionDTO): Promise<boolean> {
    const optionData = (data as { data?: ShippoOptionData }).data ?? {};
    return SHIPPO_FULFILLMENT_OPTIONS.some(
      (opt) => opt.id === optionData.id
    );
  }

  async validateOption(data: Record<string, unknown>): Promise<boolean> {
    const id = (data as ShippoOptionData).id;
    return !!id && SHIPPO_FULFILLMENT_OPTIONS.some((opt) => opt.id === id);
  }

  async validateFulfillmentData(
    _optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    _context: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return data;
  }

  async calculatePrice(
    optionData: CalculateShippingOptionPriceDTO["optionData"],
    _data: CalculateShippingOptionPriceDTO["data"],
    context: CalculateShippingOptionPriceDTO["context"]
  ): Promise<CalculatedShippingOptionPrice> {
    const opt = this.lookupOption(optionData);
    if (!opt) {
      throw new Error(
        `Shippo: unknown fulfillment option ${JSON.stringify(optionData)}`
      );
    }

    if (!context.shipping_address || !context.shipping_address.country_code) {
      // No destination yet — Medusa calls calculatePrice defensively before
      // the address step. Return 0 so the option still shows up; the real
      // quote happens once the storefront POSTs to /shipping-options/:id/calculate.
      return { calculated_amount: 0, is_calculated_price_tax_inclusive: false };
    }

    let parcels: PackedParcel[];
    try {
      parcels = await this.buildParcels(context);
    } catch (e) {
      if (e instanceof ParcelTooLargeError) {
        this.logger_.warn(`[shippo] ${e.message}`);
        return { calculated_amount: 0, is_calculated_price_tax_inclusive: false };
      }
      throw e;
    }

    if (parcels.length === 0) {
      return { calculated_amount: 0, is_calculated_price_tax_inclusive: false };
    }

    const shipment = await this.getOrFetchShipment(context, parcels);
    const rate = pickRate(shipment.rates, opt.carrier, opt.servicelevel);
    if (!rate) {
      // Carrier didn't return a rate for this shipment (dim/weight out of
      // its range, or — in Shippo's sandbox — the carrier just wasn't in
      // this particular response). Return 0 so Medusa hides the option.
      return { calculated_amount: 0, is_calculated_price_tax_inclusive: false };
    }

    return {
      calculated_amount: parseFloat(rate.amount),
      is_calculated_price_tax_inclusive: false,
    };
  }

  /**
   * Returns a cached Shippo shipment for this cart if one was fetched
   * within the last SHIPMENT_CACHE_TTL_MS; otherwise calls Shippo,
   * caches the response (only if non-empty — don't poison the cache
   * with a bad sandbox response), and returns it.
   */
  private async getOrFetchShipment(
    context: CartContext,
    parcels: PackedParcel[]
  ): Promise<ShippoShipment> {
    const key = this.shipmentCacheKey(context, parcels);
    const now = Date.now();

    const cached = this.shipmentCache_.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.shipment;
    }

    const shipment = await this.client_.createShipment({
      addressFrom: this.fromAddressForShippo(),
      addressTo: this.toAddressForShippo(context),
      parcels: parcels.map(toShippoParcel),
      metadata: `cart:${context.id ?? "unknown"}`,
    });

    if (shipment.rates && shipment.rates.length > 0) {
      this.shipmentCache_.set(key, {
        shipment,
        expiresAt: now + ShippoFulfillmentProviderService.SHIPMENT_CACHE_TTL_MS,
      });
    }
    this.pruneShipmentCache(now);
    return shipment;
  }

  private shipmentCacheKey(context: CartContext, parcels: PackedParcel[]): string {
    const addr = context.shipping_address;
    const addrPart = addr
      ? `${addr.country_code}|${addr.postal_code}|${addr.province}|${addr.city}|${addr.address_1}`
      : "no-address";
    const parcelPart = parcels
      .map((p) => `${p.template.id}:${p.weightOz}`)
      .join(",");
    return createHash("sha1")
      .update(`${context.id ?? ""}|${addrPart}|${parcelPart}`)
      .digest("hex");
  }

  private pruneShipmentCache(now: number): void {
    for (const [key, entry] of this.shipmentCache_) {
      if (entry.expiresAt <= now) this.shipmentCache_.delete(key);
    }
  }

  async createFulfillment(
    data: Record<string, unknown>,
    _items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
    order: Partial<FulfillmentOrderDTO> | undefined,
    fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>
  ): Promise<CreateFulfillmentResult> {
    const optionData = (data as ShippoOptionData) ?? {};
    const opt = this.lookupOption(optionData);
    if (!opt) {
      throw new Error(
        `Shippo: cannot create fulfillment for unknown option ${JSON.stringify(optionData)}`
      );
    }

    const to = (fulfillment.delivery_address ??
      (order as { shipping_address?: CartContext["shipping_address"] })
        ?.shipping_address) as CartContext["shipping_address"] | undefined;
    if (!to) {
      throw new Error("Shippo: cannot create fulfillment without a shipping address");
    }

    // Rebuild a cart-like context from the order so we can reuse the same
    // parcel-build path as calculatePrice. Rates expire; re-quoting here
    // guarantees we buy the current rate for the selected service.
    const syntheticContext = orderToContext(order);
    const parcels = await this.buildParcels(syntheticContext);

    const shipment = await this.client_.createShipment({
      addressFrom: this.fromAddressForShippo(),
      addressTo: shippingAddressToShippo(to),
      parcels: parcels.map(toShippoParcel),
      metadata: `order:${(order as { id?: string })?.id ?? "unknown"}`,
    });

    const rate = pickRate(shipment.rates, opt.carrier, opt.servicelevel);
    if (!rate) {
      throw new Error(
        `Shippo: ${opt.carrier}/${opt.servicelevel} is no longer available for this shipment. Rates may have changed — re-quote in the admin.`
      );
    }

    const transaction = await this.client_.createTransaction({
      rate: rate.object_id,
      metadata: `order:${(order as { id?: string })?.id ?? "unknown"}`,
    });

    if (transaction.status === "ERROR") {
      const msg =
        transaction.messages?.map((m) => m.text).join("; ") ??
        "label purchase failed";
      throw new Error(`Shippo: ${msg}`);
    }

    return {
      data: {
        shippo_transaction_id: transaction.object_id,
        shippo_rate_id: rate.object_id,
        shippo_shipment_id: shipment.object_id,
        tracking_number: transaction.tracking_number,
        tracking_url_provider: transaction.tracking_url_provider,
        label_url: transaction.label_url,
        carrier: opt.carrier,
        servicelevel: opt.servicelevel,
      },
      labels: transaction.label_url
        ? [
            {
              tracking_number: transaction.tracking_number ?? "",
              tracking_url: transaction.tracking_url_provider ?? "",
              label_url: transaction.label_url,
            },
          ]
        : [],
    };
  }

  async cancelFulfillment(
    fulfillment: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const transactionId = (
      (fulfillment as { data?: { shippo_transaction_id?: string } }).data ?? {}
    ).shippo_transaction_id;
    if (!transactionId) return {};
    const refund = await this.client_.createRefund(transactionId);
    return { shippo_refund_id: refund.object_id, shippo_refund_status: refund.status };
  }

  async createReturnFulfillment(
    fulfillment: Record<string, unknown>
  ): Promise<CreateFulfillmentResult> {
    const data = (fulfillment as { data?: Record<string, unknown> }).data ?? {};
    const originalTransactionId =
      (data.shippo_transaction_id as string | undefined) ?? undefined;
    const to = (fulfillment as { delivery_address?: CartContext["shipping_address"] })
      .delivery_address;
    if (!to) return { data, labels: [] };

    // For returns the ship-from is the customer and ship-to is our warehouse.
    const returnShipment = await this.client_.createReturn({
      addressFrom: shippingAddressToShippo(to),
      addressTo: this.fromAddressForShippo(),
      parcels: [
        // Return label reuses the XL template as a conservative default; admins
        // can override by recreating the fulfillment with explicit parcels.
        toShippoParcel({
          template: BOX_TEMPLATES[BOX_TEMPLATES.length - 2],
          weightOz: 32,
          units: [],
        }),
      ],
      originalTransactionId,
    });

    return {
      data: {
        ...data,
        shippo_return_shipment_id: returnShipment.object_id,
      },
      labels: [],
    };
  }

  async getWebhookActionAndData(): Promise<Record<string, unknown>> {
    // Webhook handling lives in src/api/hooks/shippo/route.ts; this method
    // is not called for Shippo because the shipping module invokes it only
    // on specific lifecycle events we don't currently use.
    return {};
  }

  // ── helpers ────────────────────────────────────────────────

  private lookupOption(optionData: Record<string, unknown>) {
    const d = optionData as ShippoOptionData;
    const byId = SHIPPO_FULFILLMENT_OPTIONS.find((o) => o.id === d.id);
    if (byId) return byId;
    if (d.carrier && d.servicelevel) {
      return SHIPPO_FULFILLMENT_OPTIONS.find(
        (o) => o.carrier === d.carrier && o.servicelevel === d.servicelevel
      );
    }
    return null;
  }

  private fromAddressForShippo(): ShippoAddress {
    const a = this.options_.fromAddress;
    return {
      name: a.name,
      street1: a.street1,
      street2: a.street2,
      city: a.city,
      state: a.state,
      zip: a.zip,
      country: a.country,
      phone: a.phone,
      email: a.email,
    };
  }

  private toAddressForShippo(context: CartContext): ShippoAddress {
    return shippingAddressToShippo(context.shipping_address);
  }

  private async buildParcels(context: CartContext): Promise<PackedParcel[]> {
    const items = (context.items ?? []) as Array<{
      variant_id?: string | null;
      variant_sku?: string | null;
      quantity: number;
      variant?: {
        sku?: string | null;
        weight?: number | null;
        length?: number | null;
        width?: number | null;
        height?: number | null;
      } | null;
    }>;

    const units: ParcelUnit[] = [];
    for (const item of items) {
      const v = item.variant;
      if (!v) {
        this.logger_.warn(
          `[shippo] cart item for variant ${item.variant_id ?? "?"} has no nested variant data; skipping`
        );
        continue;
      }
      if (
        v.weight == null ||
        v.length == null ||
        v.width == null ||
        v.height == null
      ) {
        throw new Error(
          `Shippo: variant ${v.sku ?? item.variant_id ?? "?"} is missing weight/dims. ` +
            `Set them on the product variant (including bundle variants — bundle parcel dims can be the summed-component fallback populated by seed).`
        );
      }
      const sku = v.sku ?? item.variant_sku ?? item.variant_id ?? "unknown";
      for (let i = 0; i < (item.quantity ?? 1); i++) {
        units.push({
          sku,
          weightOz: v.weight,
          lengthIn: v.length,
          widthIn: v.width,
          heightIn: v.height,
        });
      }
    }

    return packUnitsIntoParcels(units);
  }
}

// ── pure helpers (exported for testability) ─────────────────────

function toShippoParcel(packed: PackedParcel): ShippoParcel {
  return {
    length: packed.template.lengthIn.toString(),
    width: packed.template.widthIn.toString(),
    height: packed.template.heightIn.toString(),
    distance_unit: "in",
    weight: packed.weightOz.toString(),
    mass_unit: "oz",
  };
}

function pickRate(
  rates: ShippoRate[],
  carrier: string,
  servicelevel: string
): ShippoRate | undefined {
  return rates.find(
    (r) =>
      r.provider?.toLowerCase() === carrier.toLowerCase() &&
      r.servicelevel?.token === servicelevel
  );
}

function shippingAddressToShippo(
  address: CartContext["shipping_address"] | undefined
): ShippoAddress {
  if (!address) {
    throw new Error("Shippo: missing shipping address");
  }
  const a = address as {
    first_name?: string | null;
    last_name?: string | null;
    company?: string | null;
    address_1?: string | null;
    address_2?: string | null;
    city?: string | null;
    province?: string | null;
    postal_code?: string | null;
    country_code?: string | null;
    phone?: string | null;
  };
  return {
    name: [a.first_name, a.last_name].filter(Boolean).join(" ") || undefined,
    company: a.company ?? undefined,
    street1: a.address_1 ?? "",
    street2: a.address_2 ?? undefined,
    city: a.city ?? "",
    state: a.province ?? "",
    zip: a.postal_code ?? "",
    country: (a.country_code ?? "US").toUpperCase(),
    phone: a.phone ?? undefined,
  };
}

function orderToContext(
  order: Partial<FulfillmentOrderDTO> | undefined
): CartContext {
  const o = (order ?? {}) as {
    id?: string;
    items?: Array<{ variant_id?: string | null; variant_sku?: string | null; quantity: number }>;
    shipping_address?: CartContext["shipping_address"];
    currency_code?: string;
  };
  // We only need the subset of CartContext fields that buildParcels reads
  // (items, shipping_address). The cast is intentional — buildParcels treats
  // items as a loosely-typed array and looks up full variant data via
  // query.graph rather than relying on CartLineItemDTO's nested fields.
  return {
    id: o.id,
    items: o.items ?? [],
    shipping_address: o.shipping_address,
    currency_code: o.currency_code,
  } as unknown as CartContext;
}

export default ShippoFulfillmentProviderService;
