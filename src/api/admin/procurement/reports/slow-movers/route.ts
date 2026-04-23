/**
 * Admin API: slow-movers report.
 *
 * GET /admin/procurement/reports/slow-movers?days=90
 *   → { rows: [{ inventory_item_id, sku, product_title, variant_title,
 *                lot_id, received_at, age_days, qty_remaining,
 *                unit_cost, stuck_value }], totals: { count, stuck_value } }
 *
 * Active inventory lots with `received_at` older than the threshold
 * and positive qty_remaining. Useful for spotting dead stock and
 * planning markdowns.
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
  lot_id: string;
  received_at: string;
  age_days: number;
  qty_remaining: number;
  unit_cost: number;
  stuck_value: number;
};

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const days = Number(req.query.days ?? 90);
  const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const procurement = req.scope.resolve(
    PROCUREMENT_MODULE,
  ) as ProcurementModuleService;

  const lots = await procurement.listInventoryLots({
    status: "active",
  });

  const stuck = lots.filter((l) => {
    if (Number(l.qty_remaining) <= 0) return false;
    const receivedAt = new Date(l.received_at as unknown as string);
    return receivedAt < threshold;
  });

  const displayByInvId = await loadVariantDisplayByInventoryItem(req.scope);

  const now = Date.now();
  const rows: Row[] = stuck.map((l) => {
    const receivedAt = new Date(l.received_at as unknown as string);
    const ageDays = Math.floor((now - receivedAt.getTime()) / (24 * 60 * 60 * 1000));
    const display = displayByInvId.get(l.inventory_item_id) ?? {
      sku: null,
      product_title: null,
      variant_title: null,
    };
    return {
      inventory_item_id: l.inventory_item_id,
      sku: display.sku,
      product_title: display.product_title,
      variant_title: display.variant_title,
      lot_id: l.id,
      received_at: (l.received_at as unknown as string),
      age_days: ageDays,
      qty_remaining: Number(l.qty_remaining),
      unit_cost: Number(l.unit_cost),
      stuck_value: Number(l.qty_remaining) * Number(l.unit_cost),
    };
  });

  rows.sort((a, b) => b.age_days - a.age_days);

  res.json({
    rows,
    totals: {
      count: rows.length,
      stuck_value: rows.reduce((s, r) => s + r.stuck_value, 0),
    },
    threshold_days: days,
    generated_at: new Date().toISOString(),
  });
};
