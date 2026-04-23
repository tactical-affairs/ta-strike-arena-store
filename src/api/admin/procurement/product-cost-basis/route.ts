/**
 * Admin API: per-variant FIFO cost basis for one product.
 *
 * GET /admin/procurement/product-cost-basis?product_id=prod_...
 *   → { rows: [{ variant_id, variant_title, sku, inventory_item_id,
 *                active_lots, qty_on_hand, weighted_avg_cost,
 *                inventory_value }] }
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { PROCUREMENT_MODULE } from "../../../../modules/procurement";
import type ProcurementModuleService from "../../../../modules/procurement/service";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const productId = String(req.query.product_id ?? "");
  if (!productId) {
    res.status(400).json({ message: "product_id is required" });
    return;
  }

  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const procurement = req.scope.resolve(
    PROCUREMENT_MODULE,
  ) as ProcurementModuleService;

  // Resolve product → its variants → each variant's inventory_item
  const { data: products } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "variants.id",
      "variants.sku",
      "variants.title",
      "variants.inventory_items.inventory.id",
    ],
    filters: { id: productId },
  });
  const product = products[0];
  if (!product) {
    res.json({ rows: [] });
    return;
  }

  const rows: Array<Record<string, unknown>> = [];
  for (const variant of product.variants ?? []) {
    const inventoryItemId = variant.inventory_items?.[0]?.inventory?.id ?? null;
    if (!inventoryItemId) {
      rows.push({
        variant_id: variant.id,
        variant_title: variant.title,
        sku: variant.sku,
        inventory_item_id: null,
        active_lots: 0,
        qty_on_hand: 0,
        weighted_avg_cost: null,
        inventory_value: 0,
      });
      continue;
    }
    const lots = await procurement.listInventoryLots({
      inventory_item_id: inventoryItemId,
      status: "active",
    });
    const qty = lots.reduce((s, l) => s + Number(l.qty_remaining), 0);
    const value = lots.reduce(
      (s, l) => s + Number(l.qty_remaining) * Number(l.unit_cost),
      0,
    );
    rows.push({
      variant_id: variant.id,
      variant_title: variant.title,
      sku: variant.sku,
      inventory_item_id: inventoryItemId,
      active_lots: lots.filter((l) => Number(l.qty_remaining) > 0).length,
      qty_on_hand: qty,
      weighted_avg_cost: qty > 0 ? value / qty : null,
      inventory_value: value,
    });
  }

  res.json({ rows });
};
