/**
 * Push placed orders + order cancellations to TaxJar so their Economic
 * Nexus Insights dashboard can track state-by-state thresholds and so
 * AutoFile-enabled states see the right volumes on filing day.
 *
 * We build a fresh TaxJarClient here rather than resolving one from the
 * container because the tax module provider's client isn't exposed
 * through Medusa's DI — identical to how a minimal setup would look in
 * any Medusa v2 subscriber.
 *
 * Failures in this subscriber NEVER block the order. On an API error we
 * log and move on; the customer-facing totals are already authoritative.
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { Modules } from "@medusajs/framework/utils";
import { TaxJarClient } from "../modules/tax-taxjar/client";

type OrderAddress = {
  first_name?: string | null;
  last_name?: string | null;
  address_1?: string | null;
  address_2?: string | null;
  city?: string | null;
  /** Medusa v2 stores the state code in `province` on order addresses. */
  province?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
};

type OrderItem = {
  id: string;
  title?: string | null;
  product_title?: string | null;
  variant_sku?: string | null;
  quantity: number;
  unit_price: number | string;
  subtotal?: number | string;
  tax_total?: number | string;
};

type OrderLike = {
  id: string;
  display_id?: number;
  created_at?: string | Date;
  currency_code?: string;
  shipping_address?: OrderAddress | null;
  items?: OrderItem[];
  subtotal?: number | string;
  shipping_total?: number | string;
  tax_total?: number | string;
  total?: number | string;
};

function num(v: unknown, fallback = 0): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }
  return fallback;
}

function getClient(): TaxJarClient | null {
  if (!process.env.TAXJAR_API_KEY) return null;
  return new TaxJarClient({
    apiKey: process.env.TAXJAR_API_KEY,
    sandbox: process.env.TAXJAR_SANDBOX !== "false",
  });
}

function fromAddress() {
  return {
    country: "US",
    zip: process.env.TAXJAR_FROM_ZIP ?? process.env.SHIPPO_FROM_ZIP ?? "",
    state:
      process.env.TAXJAR_FROM_STATE ?? process.env.SHIPPO_FROM_STATE ?? "",
    city: process.env.TAXJAR_FROM_CITY ?? process.env.SHIPPO_FROM_CITY,
    street:
      process.env.TAXJAR_FROM_STREET1 ?? process.env.SHIPPO_FROM_STREET1,
  };
}

export default async function taxjarOrderSync({
  event: { data, name },
  container,
}: SubscriberArgs<{ id: string }>) {
  const client = getClient();
  if (!client) return;

  const logger = container.resolve("logger");
  const orderService = container.resolve(Modules.ORDER);

  if (name === "order.canceled") {
    try {
      await client.deleteOrderTransaction(data.id);
      logger.info(`[taxjar-order-sync] deleted order ${data.id}`);
    } catch (err) {
      logger.error(
        `[taxjar-order-sync] delete failed for ${data.id}: ${
          (err as Error).message
        }`,
      );
    }
    return;
  }

  if (name !== "order.placed") return;

  let order: OrderLike;
  try {
    order = (await orderService.retrieveOrder(data.id, {
      relations: ["items", "shipping_address"],
    })) as unknown as OrderLike;
  } catch (err) {
    logger.error(
      `[taxjar-order-sync] retrieve failed for ${data.id}: ${
        (err as Error).message
      }`,
    );
    return;
  }

  const shipping = order.shipping_address;
  if (!shipping?.country_code || !shipping?.province || !shipping?.postal_code) {
    // Cart created without a full ship-to address — nothing meaningful
    // to sync (would just be noise in the TaxJar dashboard).
    return;
  }

  const from = fromAddress();
  const transactionDate = (order.created_at ?? new Date()).toString();

  try {
    await client.createOrderTransaction({
      transaction_id: order.id,
      transaction_date: new Date(transactionDate).toISOString(),
      provider: "medusa",
      from_country: from.country,
      from_zip: from.zip,
      from_state: from.state.toUpperCase(),
      from_city: from.city,
      from_street: from.street,
      to_country: shipping.country_code.toUpperCase(),
      to_zip: shipping.postal_code,
      to_state: shipping.province.toUpperCase(),
      to_city: shipping.city ?? undefined,
      to_street: shipping.address_1 ?? undefined,
      amount: num(order.subtotal) + num(order.shipping_total),
      shipping: num(order.shipping_total),
      sales_tax: num(order.tax_total),
      line_items: (order.items ?? []).map((item, idx) => ({
        id: item.id ?? `line_${idx}`,
        quantity: num(item.quantity, 1),
        product_identifier: item.variant_sku ?? undefined,
        description: item.product_title ?? item.title ?? undefined,
        unit_price: num(item.unit_price),
        sales_tax: num(item.tax_total),
      })),
    });
    logger.info(
      `[taxjar-order-sync] synced order ${order.id} to TaxJar`,
    );
  } catch (err) {
    logger.error(
      `[taxjar-order-sync] sync failed for ${order.id}: ${
        (err as Error).message
      }`,
    );
  }
}

export const config: SubscriberConfig = {
  event: ["order.placed", "order.canceled"],
};
