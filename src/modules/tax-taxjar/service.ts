/**
 * TaxJar Tax Module Provider.
 *
 * Wires Medusa v2's tax module into TaxJar for live sales-tax calculation
 * at checkout. For every cart refresh Medusa calls `getTaxLines` with the
 * active line items + shipping method + ship-to address; we forward that
 * to TaxJar's `/taxes` endpoint and translate the response into Medusa's
 * per-line tax line DTOs.
 *
 * Nexus rules live in the TaxJar dashboard, not in our code. If the
 * customer is shipping to a state where we're not registered, TaxJar
 * returns `has_nexus: false` and `amount_to_collect: 0` — we emit no
 * tax lines for that cart.
 *
 * Completed orders and refunds are synced to TaxJar in a separate
 * subscriber (`src/subscribers/taxjar-order-sync.ts`) so the TaxJar
 * dashboard's Economic Nexus Insights + AutoFile can see real volumes.
 */

import type {
  ITaxProvider,
  Logger,
  TaxTypes,
} from "@medusajs/framework/types";
import {
  TaxJarClient,
  type TaxJarAddress,
  type TaxJarLineItem,
  type TaxJarTaxResponse,
} from "./client";

export type TaxJarFromAddress = {
  zip: string;
  state: string;
  country: string;
  city?: string;
  street?: string;
};

export type TaxJarProviderOptions = {
  apiKey: string;
  sandbox?: boolean;
  fromAddress: TaxJarFromAddress;
};

type InjectedDependencies = {
  logger: Logger;
};

type CalcLine = TaxTypes.ItemTaxCalculationLine;
type ShipLine = TaxTypes.ShippingTaxCalculationLine;
type TaxLine = TaxTypes.ItemTaxLineDTO | TaxTypes.ShippingTaxLineDTO;

const TAX_LINE_NAME = "Sales tax";

function toNumber(v: unknown, fallback = 0): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

/**
 * Convert TaxJar's decimal `combined_tax_rate` (e.g. 0.101) to Medusa's
 * percent form (e.g. 10.1). Medusa later applies this as
 * `line_subtotal * rate / 100`.
 */
function rateToPercent(decimalRate: number | undefined): number {
  if (!decimalRate || !Number.isFinite(decimalRate)) return 0;
  return decimalRate * 100;
}

export default class TaxJarProviderService implements ITaxProvider {
  static identifier = "taxjar";

  protected logger_: Logger;
  protected options_: TaxJarProviderOptions;
  protected client_: TaxJarClient;

  constructor(deps: InjectedDependencies, options: TaxJarProviderOptions) {
    this.logger_ = deps.logger;
    this.options_ = options;
    this.client_ = new TaxJarClient({
      apiKey: options.apiKey,
      sandbox: options.sandbox,
    });
  }

  getIdentifier(): string {
    return TaxJarProviderService.identifier;
  }

  async getTaxLines(
    itemLines: CalcLine[],
    shippingLines: ShipLine[],
    context: TaxTypes.TaxCalculationContext,
  ): Promise<TaxLine[]> {
    // Without a ship-to address we can't ask TaxJar anything.
    // `country_code` is required on the context; state may be missing
    // early in the flow.
    const to = context.address;
    if (!to?.country_code || !to?.postal_code || !to?.province_code) {
      return [];
    }

    const from = this.options_.fromAddress;
    const shippingAmount = (shippingLines ?? []).reduce(
      (sum, l) => sum + toNumber(l.shipping_line.unit_price),
      0,
    );
    const itemsSubtotal = itemLines.reduce((sum, l) => {
      const qty = toNumber(l.line_item.quantity, 1);
      return sum + toNumber(l.line_item.unit_price) * qty;
    }, 0);

    if (itemsSubtotal <= 0 && shippingAmount <= 0) return [];

    const payloadLineItems: TaxJarLineItem[] = itemLines.map((l, i) => ({
      id: l.line_item.id ?? `line_${i}`,
      quantity: toNumber(l.line_item.quantity, 1),
      unit_price: toNumber(l.line_item.unit_price),
    }));

    const toAddress: TaxJarAddress = {
      country: to.country_code.toUpperCase(),
      zip: to.postal_code,
      state: (to.province_code ?? "").toUpperCase(),
      city: to.city,
      street: to.address_1,
    };

    let taxResp: TaxJarTaxResponse;
    try {
      taxResp = await this.client_.calculateTax({
        from_country: from.country.toUpperCase(),
        from_zip: from.zip,
        from_state: from.state.toUpperCase(),
        from_city: from.city,
        from_street: from.street,
        to_country: toAddress.country,
        to_zip: toAddress.zip,
        to_state: toAddress.state,
        to_city: toAddress.city,
        to_street: toAddress.street,
        amount: itemsSubtotal + shippingAmount,
        shipping: shippingAmount,
        line_items: payloadLineItems,
      });
    } catch (err) {
      // Never block checkout on a tax-service outage. Log and return
      // zero tax — customer sees $0 tax, we pick up the phone.
      this.logger_.error(
        `[taxjar] tax calc failed; returning empty tax lines: ${
          (err as Error).message
        }`,
      );
      return [];
    }

    if (!taxResp.has_nexus || toNumber(taxResp.amount_to_collect) <= 0) {
      return [];
    }

    const lines: TaxLine[] = [];
    const breakdown = taxResp.breakdown ?? {};
    const lineBreakdowns = breakdown.line_items ?? [];

    // Prefer TaxJar's per-line breakdown. Fall back to the overall
    // `rate` if TaxJar didn't return a breakdown (rare; happens with
    // certain sandbox fixtures).
    const fallbackRate = rateToPercent(
      breakdown.combined_tax_rate ?? taxResp.rate,
    );

    for (const item of itemLines) {
      const byId = lineBreakdowns.find((b) => b.id === item.line_item.id);
      const rate = byId
        ? rateToPercent(byId.combined_tax_rate)
        : fallbackRate;
      if (rate <= 0) continue;
      lines.push({
        rate,
        code: "SALES_TAX",
        name: TAX_LINE_NAME,
        line_item_id: item.line_item.id,
        provider_id: this.getIdentifier(),
      });
    }

    if (shippingAmount > 0 && taxResp.freight_taxable) {
      const shippingRate = rateToPercent(
        breakdown.shipping?.combined_tax_rate ?? fallbackRate / 100,
      );
      // If TaxJar returns shipping-specific breakdown, use it; else
      // reuse the combined rate. (The `fallbackRate / 100` reconverts
      // to decimal to feed back into rateToPercent consistently.)
      const effective = breakdown.shipping?.combined_tax_rate
        ? shippingRate
        : fallbackRate;
      if (effective > 0) {
        for (const s of shippingLines) {
          lines.push({
            rate: effective,
            code: "SALES_TAX",
            name: TAX_LINE_NAME,
            shipping_line_id: s.shipping_line.id,
            provider_id: this.getIdentifier(),
          });
        }
      }
    }

    return lines;
  }
}
