/**
 * On return receipt, reverse COGS entries for the returned items
 * and either restock (resellable) or write off (damaged) at the
 * original cost.
 *
 * Fires on `order.return_received` — the moment ops confirms the
 * goods are physically back in the warehouse.
 *
 * Condition handling: each returned item can carry
 * `metadata.condition = "resellable" | "damaged"`. Defaults to
 * `"resellable"` if unset. Phase 2 defers building a per-item
 * dropdown in the admin return-receipt UI; until that's added,
 * condition is set via the return item's metadata (Medusa admin
 * lets ops edit metadata directly on the return item).
 *
 * Failure handling: log and continue. A failed reversal never blocks
 * the return receipt — ops can manually adjust CogsEntry rows if
 * needed.
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { PROCUREMENT_MODULE } from "../modules/procurement";
import type ProcurementModuleService from "../modules/procurement/service";

type ReturnReceivedPayload = {
  order_id?: string;
  return_id?: string;
  id?: string;
};

export default async function procurementReturnSync({
  event: { data },
  container,
}: SubscriberArgs<ReturnReceivedPayload>) {
  const logger = container.resolve("logger");
  const procurement = container.resolve(
    PROCUREMENT_MODULE,
  ) as ProcurementModuleService;
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const returnId = data.return_id ?? data.id;
  if (!returnId) {
    logger.warn(`[procurement-return-sync] no return_id in payload`);
    return;
  }

  // Load the return + items + linked order line items + variants' inventory items
  let returnRow: {
    id: string;
    order_id?: string | null;
    location_id?: string | null;
    items?: Array<{
      id: string;
      item_id?: string | null;
      quantity?: number | string | null;
      metadata?: Record<string, unknown> | null;
    } | null> | null;
  };

  try {
    const { data: rows } = await query.graph({
      entity: "return",
      fields: [
        "id",
        "order_id",
        "location_id",
        "items.id",
        "items.item_id",
        "items.quantity",
        "items.metadata",
      ],
      filters: { id: returnId },
    });
    if (!rows[0]) {
      logger.warn(
        `[procurement-return-sync] return ${returnId} not found`,
      );
      return;
    }
    returnRow = rows[0] as unknown as typeof returnRow;
  } catch (err) {
    logger.error(
      `[procurement-return-sync] failed to load return ${returnId}: ${(err as Error).message}`,
    );
    return;
  }

  const orderId = returnRow.order_id ?? data.order_id;
  if (!orderId) {
    logger.warn(
      `[procurement-return-sync] no order_id on return ${returnId}`,
    );
    return;
  }

  const returnItems = (returnRow.items ?? []).filter(
    (i): i is NonNullable<typeof i> => !!i?.item_id,
  );
  if (returnItems.length === 0) return;

  // Resolve inventory_item_id via variant_id (two-step for cross-
  // module graph reliability — same pattern as fulfillment-sync).
  let orderItems: Array<{ id: string; variant_id: string | null }> = [];
  try {
    const { data: rows } = await query.graph({
      entity: "order",
      fields: ["id", "items.id", "items.variant_id"],
      filters: { id: orderId } as never,
    });
    orderItems = ((rows[0] as { items?: typeof orderItems })?.items ?? []) as typeof orderItems;
  } catch (err) {
    logger.error(
      `[procurement-return-sync] failed to load order ${orderId}: ${(err as Error).message}`,
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
        `[procurement-return-sync] failed to load variants: ${(err as Error).message}`,
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

  // Fallback location: use the return's location_id, else the first
  // stock_location (small-scale ops = one warehouse).
  let locationId = returnRow.location_id ?? "";
  if (!locationId) {
    try {
      const { data: locs } = await query.graph({
        entity: "stock_location",
        fields: ["id"],
      });
      locationId = (locs[0]?.id as string | undefined) ?? "";
    } catch {
      // fall through
    }
  }
  if (!locationId) {
    logger.error(
      `[procurement-return-sync] no location_id available for return ${returnId}`,
    );
    return;
  }

  for (const ri of returnItems) {
    const inventoryItemId = invItemByLineItem.get(ri.item_id!);
    if (!inventoryItemId) {
      logger.warn(
        `[procurement-return-sync] no inventory_item for line ${ri.item_id} — skipping reversal`,
      );
      continue;
    }
    const qty = Number(ri.quantity ?? 0);
    if (qty <= 0) continue;

    const condition =
      ((ri.metadata ?? {}) as { condition?: "resellable" | "damaged" })
        .condition ?? "resellable";

    try {
      const res = await procurement.reverseCogsForReturn({
        order_id: orderId,
        order_line_item_id: ri.item_id!,
        inventory_item_id: inventoryItemId,
        location_id: locationId,
        qty,
        condition,
      });
      logger.info(
        `[procurement-return-sync] return ${returnId} line ${ri.item_id} condition=${condition} qty=${qty} cost_reversed=$${res.cost_reversed.toFixed(2)} new_lots=[${res.new_lot_ids.join(",")}]`,
      );
    } catch (err) {
      logger.error(
        `[procurement-return-sync] reverse failed for line ${ri.item_id}: ${(err as Error).message}`,
      );
    }
  }
}

export const config: SubscriberConfig = {
  event: "order.return_received",
};
