/**
 * Admin API: issue inventory off-the-books for non-sales reasons.
 *
 * POST /admin/procurement/inventory-issues
 *   body: {
 *     inventory_item_id: string,
 *     location_id: string,
 *     qty: number (positive integer),
 *     reason: "demo" | "sample" | "internal_use" | "damaged_post_receipt" | "write_off",
 *     notes?: string,
 *   }
 *
 * Steps (mirrors the receive flow's two-phase pattern):
 *   1. Verify the location has enough stock; refuse if not.
 *   2. Decrement core inventory_level.stocked_quantity at that location.
 *   3. Delegate to procurement.consumeForReason → walks FIFO lots,
 *      posts CogsEntry rows with the chosen reason and order linkage left null.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { Modules } from "@medusajs/framework/utils";
import { PROCUREMENT_MODULE } from "../../../../modules/procurement";
import type ProcurementModuleService from "../../../../modules/procurement/service";
import type { IssueReason } from "../../../../modules/procurement/service";

const VALID_REASONS: ReadonlyArray<IssueReason> = [
  "demo",
  "sample",
  "internal_use",
  "damaged_post_receipt",
  "write_off",
];

type Body = {
  inventory_item_id: string;
  location_id: string;
  qty: number;
  reason: IssueReason;
  notes?: string;
};

export const POST = async (
  req: MedusaRequest<Body>,
  res: MedusaResponse,
) => {
  const body = req.body ?? ({} as Body);

  if (!body.inventory_item_id || typeof body.inventory_item_id !== "string") {
    res.status(400).json({ message: "inventory_item_id is required" });
    return;
  }
  if (!body.location_id || typeof body.location_id !== "string") {
    res.status(400).json({ message: "location_id is required" });
    return;
  }
  if (typeof body.qty !== "number" || !Number.isInteger(body.qty) || body.qty <= 0) {
    res.status(400).json({ message: "qty must be a positive integer" });
    return;
  }
  if (!body.reason || !VALID_REASONS.includes(body.reason)) {
    res.status(400).json({
      message: `reason must be one of: ${VALID_REASONS.join(", ")}`,
    });
    return;
  }

  const procurement = req.scope.resolve(
    PROCUREMENT_MODULE,
  ) as ProcurementModuleService;
  const inventory = req.scope.resolve(Modules.INVENTORY);

  // 1. Check available stock at location.
  const levels = await inventory.listInventoryLevels({
    inventory_item_id: body.inventory_item_id,
    location_id: body.location_id,
  });
  const level = levels[0];
  const available = Number(level?.stocked_quantity ?? 0);
  if (available < body.qty) {
    res.status(409).json({
      message: `Only ${available} units available at this location; requested ${body.qty}`,
    });
    return;
  }

  // 2. Decrement core inventory_level.stocked_quantity.
  await inventory.updateInventoryLevels([
    {
      inventory_item_id: body.inventory_item_id,
      location_id: body.location_id,
      stocked_quantity: available - body.qty,
    },
  ]);

  // 3. Walk FIFO lots + post CogsEntry rows.
  const result = await procurement.consumeForReason({
    inventory_item_id: body.inventory_item_id,
    qty: body.qty,
    reason: body.reason,
    notes: body.notes,
  });

  res.json({
    issued: {
      inventory_item_id: body.inventory_item_id,
      location_id: body.location_id,
      qty: body.qty,
      reason: body.reason,
      notes: body.notes ?? null,
      posted_at: new Date().toISOString(),
    },
    total_cost: result.total_cost,
    entries: result.entries,
    uncovered_qty: result.uncovered_qty,
  });
};
