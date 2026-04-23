/**
 * Admin API: gross-margin report.
 *
 * GET /admin/procurement/reports/gross-margin?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   → { rows: [{ inventory_item_id, sku, product_title, variant_title,
 *                qty_sold, revenue, cogs, gross_profit, margin_pct }],
 *       totals: { revenue, cogs, gross_profit, margin_pct } }
 *
 * Revenue = sum(order_line_item.unit_price × quantity) for fulfilled
 * lines in the window (pre-tax, pre-shipping — item-level).
 * COGS = sum(cogs_entry.total_cost) where the corresponding
 * CogsEntry was posted in the window and not reversed.
 * Gross profit = revenue − COGS.
 * Margin % = (gross_profit / revenue) × 100, guarded against div-by-zero.
 *
 * Defaults: current-month window.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { PROCUREMENT_MODULE } from "../../../../../modules/procurement";
import type ProcurementModuleService from "../../../../../modules/procurement/service";
import { loadVariantDisplayByInventoryItem } from "../_display-lookup";

type Row = {
  inventory_item_id: string;
  sku: string | null;
  product_title: string | null;
  variant_title: string | null;
  qty_sold: number;
  revenue: number;
  cogs: number;
  gross_profit: number;
  margin_pct: number | null;
};

function parseDate(s: string | undefined, fallback: Date): Date {
  if (!s) return fallback;
  const d = new Date(s);
  return isNaN(d.getTime()) ? fallback : d;
}

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const from = parseDate(req.query.from as string | undefined, startOfMonth);
  const to = parseDate(req.query.to as string | undefined, now);

  const procurement = req.scope.resolve(
    PROCUREMENT_MODULE,
  ) as ProcurementModuleService;
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);

  // Step 1: collect non-reversed CogsEntry rows in window, grouped
  // by order_line_item_id, along with their unit_item (via lot).
  const entries = await procurement.listCogsEntries({});
  const inWindow = entries.filter((e) => {
    const posted = new Date(e.posted_at as unknown as string);
    if (posted < from || posted > to) return false;
    if (
      e.reversed_at &&
      new Date(e.reversed_at as unknown as string) <= to
    )
      return false;
    return true;
  });

  const lotIds = [...new Set(inWindow.map((e) => e.lot_id))];
  const invItemByLot = new Map<string, string>();
  if (lotIds.length > 0) {
    const lots = await procurement.listInventoryLots({ id: lotIds });
    for (const lot of lots) invItemByLot.set(lot.id, lot.inventory_item_id);
  }

  // Per line_item: sum COGS; per line_item also remember one inv_id.
  const cogsByLineItem = new Map<string, number>();
  const invIdByLineItem = new Map<string, string>();
  for (const e of inWindow) {
    const invId = invItemByLot.get(e.lot_id);
    if (!invId) continue;
    cogsByLineItem.set(
      e.order_line_item_id,
      (cogsByLineItem.get(e.order_line_item_id) ?? 0) + Number(e.total_cost),
    );
    invIdByLineItem.set(e.order_line_item_id, invId);
  }

  // Step 2: load the revenue side — unit_price × quantity per order
  // line item that appears in our COGS set. Query via `order` and
  // traverse to its items (direct `order_line_item` entity fetch via
  // query.graph doesn't resolve cleanly across modules).
  const orderIds = [...new Set(inWindow.map((e) => e.order_id))];
  const revenueByLineItem = new Map<
    string,
    { revenue: number; qty: number }
  >();

  if (orderIds.length > 0) {
    const { data: orders } = await query.graph({
      entity: "order",
      fields: ["id", "items.id", "items.unit_price", "items.quantity"],
      filters: { id: orderIds } as never,
    });
    for (const o of orders as Array<{
      id: string;
      items?: Array<{
        id: string;
        unit_price?: unknown;
        quantity?: unknown;
      }>;
    }>) {
      for (const it of o.items ?? []) {
        if (!cogsByLineItem.has(it.id)) continue;
        revenueByLineItem.set(it.id, {
          revenue: Number(it.unit_price) * Number(it.quantity),
          qty: Number(it.quantity),
        });
      }
    }
  }

  // Step 3: aggregate by inventory_item
  const byInventoryItem = new Map<
    string,
    { qty: number; revenue: number; cogs: number }
  >();
  for (const [lineItemId, cogs] of cogsByLineItem) {
    const invId = invIdByLineItem.get(lineItemId);
    if (!invId) continue;
    const rev = revenueByLineItem.get(lineItemId) ?? { revenue: 0, qty: 0 };
    const agg = byInventoryItem.get(invId) ?? {
      qty: 0,
      revenue: 0,
      cogs: 0,
    };
    agg.qty += rev.qty;
    agg.revenue += rev.revenue;
    agg.cogs += cogs;
    byInventoryItem.set(invId, agg);
  }

  const displayByInvId = await loadVariantDisplayByInventoryItem(req.scope);

  const rows: Row[] = [];
  let tRev = 0;
  let tCogs = 0;
  let tQty = 0;
  for (const [invId, agg] of byInventoryItem) {
    const display = displayByInvId.get(invId) ?? {
      sku: null,
      product_title: null,
      variant_title: null,
    };
    const gp = agg.revenue - agg.cogs;
    rows.push({
      inventory_item_id: invId,
      sku: display.sku,
      product_title: display.product_title,
      variant_title: display.variant_title,
      qty_sold: agg.qty,
      revenue: agg.revenue,
      cogs: agg.cogs,
      gross_profit: gp,
      margin_pct: agg.revenue > 0 ? (gp / agg.revenue) * 100 : null,
    });
    tQty += agg.qty;
    tRev += agg.revenue;
    tCogs += agg.cogs;
  }
  rows.sort((a, b) => b.gross_profit - a.gross_profit);

  const tGP = tRev - tCogs;
  res.json({
    rows,
    totals: {
      qty: tQty,
      revenue: tRev,
      cogs: tCogs,
      gross_profit: tGP,
      margin_pct: tRev > 0 ? (tGP / tRev) * 100 : null,
    },
    from: from.toISOString(),
    to: to.toISOString(),
    generated_at: new Date().toISOString(),
  });
};
