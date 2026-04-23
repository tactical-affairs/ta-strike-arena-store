/**
 * Admin API: inventory valuation report.
 *
 * GET /admin/procurement/reports/inventory-valuation
 *   → { rows: [{ inventory_item_id, sku, product_title, variant_title,
 *                active_lots, qty_on_hand, weighted_avg_cost,
 *                inventory_value }], totals: { qty, value } }
 *
 * Sum of active inventory lots grouped by inventory_item, with
 * per-variant display names pulled via the query graph. Phase-3
 * read-only report; aggregation runs in memory (fine up to ~50k lots).
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { PROCUREMENT_MODULE } from "../../../../../modules/procurement";
import type ProcurementModuleService from "../../../../../modules/procurement/service";
import { loadVariantDisplayByInventoryItem } from "../_display-lookup";

type Row = {
  inventory_item_id: string;
  sku: string | null;
  product_title: string | null;
  variant_title: string | null;
  active_lots: number;
  qty_on_hand: number;
  weighted_avg_cost: number | null;
  inventory_value: number;
};

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const procurement = req.scope.resolve(
    PROCUREMENT_MODULE,
  ) as ProcurementModuleService;

  const lots = await procurement.listInventoryLots({
    status: "active",
  });

  const byInventoryItem = new Map<
    string,
    { lots: number; qty: number; value: number }
  >();
  for (const lot of lots) {
    const qty = Number(lot.qty_remaining);
    if (qty <= 0) continue;
    const entry = byInventoryItem.get(lot.inventory_item_id) ?? {
      lots: 0,
      qty: 0,
      value: 0,
    };
    entry.lots += 1;
    entry.qty += qty;
    entry.value += qty * Number(lot.unit_cost);
    byInventoryItem.set(lot.inventory_item_id, entry);
  }

  const displayByInvId = await loadVariantDisplayByInventoryItem(req.scope);

  const rows: Row[] = [];
  let totalQty = 0;
  let totalValue = 0;
  for (const [invId, agg] of byInventoryItem) {
    const display = displayByInvId.get(invId) ?? {
      sku: null,
      product_title: null,
      variant_title: null,
    };
    rows.push({
      inventory_item_id: invId,
      sku: display.sku,
      product_title: display.product_title,
      variant_title: display.variant_title,
      active_lots: agg.lots,
      qty_on_hand: agg.qty,
      weighted_avg_cost: agg.qty > 0 ? agg.value / agg.qty : null,
      inventory_value: agg.value,
    });
    totalQty += agg.qty;
    totalValue += agg.value;
  }

  rows.sort((a, b) => (b.inventory_value ?? 0) - (a.inventory_value ?? 0));

  res.json({
    rows,
    totals: { qty: totalQty, value: totalValue },
    generated_at: new Date().toISOString(),
  });
};
