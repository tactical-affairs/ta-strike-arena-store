/**
 * Admin API: COGS by period report.
 *
 * GET /admin/procurement/reports/cogs?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   → { rows: [{ inventory_item_id, sku, product_title, variant_title,
 *                qty_sold, cogs_gross, cogs_reversed, cogs_net,
 *                entry_count }],
 *       totals: { qty, cogs_gross, cogs_reversed, cogs_net } }
 *
 * Aggregates non-reversed CogsEntry rows in the window, grouped by
 * inventory_item via the lot → inventory_item join. Reversed entries
 * (returns) are listed separately so the net figure matches what
 * the accountant posts.
 *
 * Defaults: `from` = start of current month, `to` = now.
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
  qty_sold: number;
  cogs_gross: number;
  cogs_reversed: number;
  cogs_net: number;
  entry_count: number;
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

  // Load all CogsEntry in window (posted_at between from and to).
  // `reversed_at` > to means the reversal happens outside the window
  // and shouldn't be counted in cogs_reversed.
  const entries = await procurement.listCogsEntries({});
  const inWindow = entries.filter((e) => {
    const posted = new Date(e.posted_at as unknown as string);
    return posted >= from && posted <= to;
  });

  // Resolve lot → inventory_item mapping for grouping.
  const lotIds = [...new Set(inWindow.map((e) => e.lot_id))];
  const invItemByLot = new Map<string, string>();
  if (lotIds.length > 0) {
    const lots = await procurement.listInventoryLots({ id: lotIds });
    for (const lot of lots) {
      invItemByLot.set(lot.id, lot.inventory_item_id);
    }
  }

  const byInventoryItem = new Map<
    string,
    { qty: number; gross: number; reversed: number; count: number }
  >();
  for (const e of inWindow) {
    const invId = invItemByLot.get(e.lot_id);
    if (!invId) continue;
    const qty = Number(e.qty);
    const total = Number(e.total_cost);
    const isReversed =
      e.reversed_at &&
      new Date(e.reversed_at as unknown as string) <= to;
    const row = byInventoryItem.get(invId) ?? {
      qty: 0,
      gross: 0,
      reversed: 0,
      count: 0,
    };
    if (isReversed) {
      row.reversed += total;
    } else {
      row.qty += qty;
      row.gross += total;
    }
    row.count += 1;
    byInventoryItem.set(invId, row);
  }

  const displayByInvId = await loadVariantDisplayByInventoryItem(req.scope);

  const rows: Row[] = [];
  let tQty = 0;
  let tGross = 0;
  let tRev = 0;
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
      qty_sold: agg.qty,
      cogs_gross: agg.gross,
      cogs_reversed: agg.reversed,
      cogs_net: agg.gross - agg.reversed,
      entry_count: agg.count,
    });
    tQty += agg.qty;
    tGross += agg.gross;
    tRev += agg.reversed;
  }
  rows.sort((a, b) => b.cogs_net - a.cogs_net);

  res.json({
    rows,
    totals: {
      qty: tQty,
      cogs_gross: tGross,
      cogs_reversed: tRev,
      cogs_net: tGross - tRev,
    },
    from: from.toISOString(),
    to: to.toISOString(),
    generated_at: new Date().toISOString(),
  });
};
