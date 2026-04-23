/**
 * Dev-only: exercise procurement.consumeFifo against Pro Target's
 * active lots, post CogsEntry rows, print the result. Then reverse
 * the consumption so the state returns to what it was.
 *
 *   medusa exec ./src/scripts/test-cogs.ts
 */

import type { ExecArgs } from "@medusajs/framework/types";
import { PROCUREMENT_MODULE } from "../modules/procurement";
import type ProcurementModuleService from "../modules/procurement/service";

export default async function testCogs({ container }: ExecArgs) {
  const procurement = container.resolve(
    PROCUREMENT_MODULE,
  ) as ProcurementModuleService;
  const logger = container.resolve("logger");

  const INV_ITEM = "iitem_01KPXMM3GD147S4V46DB0S4YS1"; // Pro Target
  const LOC = "sloc_01KPXMM3ABVG7SEQT0TVGRYT1K";
  const FAKE_ORDER = "order_cogs_test";
  const FAKE_LINE = "ordli_cogs_test_1";

  // Starting state
  const before = await procurement.listInventoryLots(
    { inventory_item_id: INV_ITEM, status: "active" },
    { order: { received_at: "ASC" } },
  );
  logger.info(
    `[test-cogs] Before: ${before.length} active lots: ${before
      .map((l) => `${l.qty_remaining}@$${Number(l.unit_cost)}`)
      .join(", ")}`,
  );

  // Consume 8 units — should take 6 from lot1 ($150) + 2 from lot2 ($152) = $1204
  const result = await procurement.consumeFifo({
    order_id: FAKE_ORDER,
    order_line_item_id: FAKE_LINE,
    inventory_item_id: INV_ITEM,
    qty: 8,
  });
  logger.info(
    `[test-cogs] Consumed 8 units. total_cost=$${result.total_cost.toFixed(2)} uncovered=${result.uncovered_qty}`,
  );
  for (const e of result.entries) {
    logger.info(
      `[test-cogs]   lot=${e.lot_id} qty=${e.qty} @ $${e.unit_cost} = $${e.total_cost.toFixed(2)}`,
    );
  }

  // Check lots after
  const after = await procurement.listInventoryLots(
    { inventory_item_id: INV_ITEM },
    { order: { received_at: "ASC" } },
  );
  logger.info(
    `[test-cogs] After: ${after
      .map(
        (l) =>
          `${l.qty_remaining}@$${Number(l.unit_cost)} (${l.status})`,
      )
      .join(", ")}`,
  );

  // Check CogsEntry
  const entries = await procurement.listCogsEntries({
    order_line_item_id: FAKE_LINE,
  });
  logger.info(`[test-cogs] CogsEntry rows: ${entries.length}`);
  for (const e of entries) {
    logger.info(
      `[test-cogs]   entry=${e.id} qty=${e.qty} unit_cost=$${Number(e.unit_cost)} total=$${Number(e.total_cost)}`,
    );
  }

  // Reverse to restore pre-test state — exercises the return path
  const reverseResult = await procurement.reverseCogsForReturn({
    order_id: FAKE_ORDER,
    order_line_item_id: FAKE_LINE,
    inventory_item_id: INV_ITEM,
    location_id: LOC,
    qty: 8,
    condition: "resellable",
  });
  logger.info(
    `[test-cogs] Reversed. cost_reversed=$${reverseResult.cost_reversed.toFixed(2)} new_lot_id=${reverseResult.new_lot_id}`,
  );

  const final = await procurement.listInventoryLots(
    { inventory_item_id: INV_ITEM, status: "active" },
    { order: { received_at: "ASC" } },
  );
  logger.info(
    `[test-cogs] Final active: ${final
      .map(
        (l) =>
          `${l.qty_remaining}@$${Number(l.unit_cost)} (src=${l.source})`,
      )
      .join(", ")}`,
  );
}
