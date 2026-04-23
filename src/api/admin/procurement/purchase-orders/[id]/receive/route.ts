/**
 * Admin API: receive a purchase order (partial or full).
 *
 * POST /admin/procurement/purchase-orders/:id/receive
 * body: {
 *   location_id: string,
 *   lines: [{ po_line_id, inventory_item_id, qty_received }, ...]
 * }
 *
 * Steps:
 *   1. Delegate to procurement service → creates InventoryLot rows + bumps
 *      qty_received on each PO line.
 *   2. Bump core inventory_level.stocked_quantity by the same qty for
 *      each (inventory_item, location) pair.
 *
 * These are sequential, not transactional across modules — if step 2
 * fails the lots will exist but stock won't reflect them. A follow-up
 * `reconcile-stock` workflow is a phase-2 hardening step.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { Modules } from "@medusajs/framework/utils";
import { PROCUREMENT_MODULE } from "../../../../../../modules/procurement";
import type ProcurementModuleService from "../../../../../../modules/procurement/service";
import type { ReceivePurchaseOrderInput } from "../../../../../../modules/procurement/service";

export const POST = async (
  req: MedusaRequest<Omit<ReceivePurchaseOrderInput, "purchase_order_id">>,
  res: MedusaResponse,
) => {
  const { id } = req.params as { id: string };
  const body = req.body;

  if (!body?.location_id) {
    res.status(400).json({ message: "location_id is required" });
    return;
  }
  if (!body.lines?.length) {
    res.status(400).json({ message: "lines is required" });
    return;
  }

  const procurement = req.scope.resolve(
    PROCUREMENT_MODULE,
  ) as ProcurementModuleService;
  const inventory = req.scope.resolve(Modules.INVENTORY);

  const { lots_created, po_status } = await procurement.receivePurchaseOrder({
    purchase_order_id: id,
    location_id: body.location_id,
    received_at: body.received_at,
    lines: body.lines,
  });

  // Bump core inventory_level.stocked_quantity per inventory_item.
  for (const line of body.lines) {
    if (line.qty_received <= 0) continue;
    const levels = await inventory.listInventoryLevels({
      inventory_item_id: line.inventory_item_id,
      location_id: body.location_id,
    });
    const level = levels[0];
    if (!level) {
      // No inventory_level row yet — create one at this location with
      // the received quantity as opening stock.
      await inventory.createInventoryLevels({
        inventory_item_id: line.inventory_item_id,
        location_id: body.location_id,
        stocked_quantity: line.qty_received,
      });
      continue;
    }
    await inventory.updateInventoryLevels([
      {
        inventory_item_id: line.inventory_item_id,
        location_id: body.location_id,
        stocked_quantity:
          Number(level.stocked_quantity ?? 0) + Number(line.qty_received),
      },
    ]);
  }

  const purchase_order = await procurement.retrievePurchaseOrder(id, {
    relations: ["lines", "supplier", "adjustments"],
  });
  res.json({
    purchase_order,
    lots_created,
    po_status,
  });
};
