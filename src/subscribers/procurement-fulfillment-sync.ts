/**
 * On order fulfillment, consume FIFO inventory lots for each
 * fulfilled line item and write CogsEntry rows.
 *
 * Runs on `order.fulfillment_created` — the moment inventory is
 * committed to the customer. This is strictly before shipment and
 * slightly early in strict GAAP terms (COGS posts at title transfer),
 * but it's the decisive operational event for a small business and
 * matches when we actually decrement on-hand inventory.
 *
 * Failure handling: log and continue. A failed COGS post never blocks
 * the fulfillment — the customer-facing flow is authoritative, and
 * we can backfill CogsEntry rows later if needed.
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { PROCUREMENT_MODULE } from "../modules/procurement";
import type ProcurementModuleService from "../modules/procurement/service";

type FulfillmentEventPayload = {
  order_id: string;
  fulfillment_id?: string;
  id?: string;
};

export default async function procurementFulfillmentSync({
  event: { data },
  container,
}: SubscriberArgs<FulfillmentEventPayload>) {
  const logger = container.resolve("logger");
  const procurement = container.resolve(
    PROCUREMENT_MODULE,
  ) as ProcurementModuleService;
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const fulfillmentId = data.fulfillment_id ?? data.id;
  if (!fulfillmentId) {
    logger.warn(
      `[procurement-fulfillment-sync] no fulfillment_id in payload`,
    );
    return;
  }

  let fulfillment: {
    id: string;
    items?: Array<{
      line_item_id?: string | null;
      quantity?: number | string | null;
    } | null> | null;
  };

  try {
    const { data: rows } = await query.graph({
      entity: "fulfillment",
      fields: ["id", "items.line_item_id", "items.quantity"],
      filters: { id: fulfillmentId },
    });
    if (!rows[0]) {
      logger.warn(
        `[procurement-fulfillment-sync] fulfillment ${fulfillmentId} not found`,
      );
      return;
    }
    fulfillment = rows[0] as typeof fulfillment;
  } catch (err) {
    logger.error(
      `[procurement-fulfillment-sync] failed to load fulfillment ${fulfillmentId}: ${(err as Error).message}`,
    );
    return;
  }

  const fulfillmentItems = (fulfillment.items ?? []).filter(
    (i): i is { line_item_id: string; quantity: number | string } =>
      !!i?.line_item_id,
  );
  if (fulfillmentItems.length === 0) return;

  // Resolve inventory_item_id for each fulfilled line item. Medusa v2's
  // cross-module graph from order.items → product.variant → inventory
  // is brittle on certain paths, so do it in two steps:
  //   1) Load order items with their variant_id.
  //   2) Separately query the variants for their inventory_items.
  let orderItems: Array<{ id: string; variant_id: string | null }> = [];
  try {
    const { data: rows } = await query.graph({
      entity: "order",
      fields: ["id", "items.id", "items.variant_id"],
      filters: { id: data.order_id } as never,
    });
    orderItems = ((rows[0] as { items?: typeof orderItems })?.items ?? []) as typeof orderItems;
  } catch (err) {
    logger.error(
      `[procurement-fulfillment-sync] failed to load order ${data.order_id}: ${(err as Error).message}`,
    );
    return;
  }

  const variantIds = [
    ...new Set(
      orderItems
        .map((oi) => oi.variant_id)
        .filter((v): v is string => !!v),
    ),
  ];

  const invItemByVariant = new Map<string, string>();
  if (variantIds.length > 0) {
    try {
      const { data: variants } = await query.graph({
        entity: "product_variant",
        fields: ["id", "inventory_items.inventory.id"],
        filters: { id: variantIds } as never,
      });
      for (const v of variants as Array<{
        id: string;
        inventory_items?: Array<{ inventory?: { id: string } }>;
      }>) {
        const invId = v.inventory_items?.[0]?.inventory?.id;
        if (invId) invItemByVariant.set(v.id, invId);
      }
    } catch (err) {
      logger.error(
        `[procurement-fulfillment-sync] failed to load variants: ${(err as Error).message}`,
      );
      return;
    }
  }

  const invItemByLineItem = new Map<string, string>();
  for (const oi of orderItems) {
    if (!oi.variant_id) continue;
    const invId = invItemByVariant.get(oi.variant_id);
    if (invId) invItemByLineItem.set(oi.id, invId);
  }

  let totalCogs = 0;
  let totalUncovered = 0;

  for (const f of fulfillmentItems) {
    const inventoryItemId = invItemByLineItem.get(f.line_item_id);
    if (!inventoryItemId) {
      logger.warn(
        `[procurement-fulfillment-sync] no inventory_item for line ${f.line_item_id} — skipping COGS post`,
      );
      continue;
    }
    const qty = Number(f.quantity ?? 0);
    if (qty <= 0) continue;

    try {
      const res = await procurement.consumeFifo({
        order_id: data.order_id,
        order_line_item_id: f.line_item_id,
        inventory_item_id: inventoryItemId,
        qty,
      });
      totalCogs += res.total_cost;
      totalUncovered += res.uncovered_qty;
    } catch (err) {
      logger.error(
        `[procurement-fulfillment-sync] consumeFifo failed for line ${f.line_item_id}: ${(err as Error).message}`,
      );
    }
  }

  if (totalUncovered > 0) {
    logger.warn(
      `[procurement-fulfillment-sync] order ${data.order_id} has ${totalUncovered} unit(s) with no lot coverage — usually means opening balance wasn't imported for that SKU`,
    );
  }

  logger.info(
    `[procurement-fulfillment-sync] order ${data.order_id} fulfillment ${fulfillmentId} — COGS posted $${totalCogs.toFixed(2)}`,
  );
}

export const config: SubscriberConfig = {
  event: "order.fulfillment_created",
};
