/**
 * Admin API: edit or remove a single line on a purchase order.
 *
 * PATCH  /admin/procurement/purchase-orders/:id/lines/:lineId
 *   body: { qty_ordered?, unit_cost? }
 * DELETE /admin/procurement/purchase-orders/:id/lines/:lineId
 *
 * Rules:
 *   - PO must not be closed/canceled.
 *   - qty_ordered cannot drop below qty_received (would imply un-receiving lots).
 *   - DELETE refused if qty_received > 0 — those lots already exist in inventory.
 *   - unit_cost edits affect future landed-cost allocations only; lots already
 *     received keep their original landed cost (matches the adjustments contract).
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { PROCUREMENT_MODULE } from "../../../../../../../modules/procurement";
import type ProcurementModuleService from "../../../../../../../modules/procurement/service";

type PatchLineBody = {
  qty_ordered?: number;
  unit_cost?: number;
};

export const PATCH = async (
  req: MedusaRequest<PatchLineBody>,
  res: MedusaResponse,
) => {
  const { id, lineId } = req.params as { id: string; lineId: string };
  const body = req.body ?? ({} as PatchLineBody);

  if (body.qty_ordered === undefined && body.unit_cost === undefined) {
    res
      .status(400)
      .json({ message: "At least one of qty_ordered, unit_cost is required" });
    return;
  }
  if (body.qty_ordered !== undefined && body.qty_ordered <= 0) {
    res.status(400).json({ message: "qty_ordered must be > 0" });
    return;
  }
  if (body.unit_cost !== undefined && body.unit_cost < 0) {
    res.status(400).json({ message: "unit_cost must be ≥ 0" });
    return;
  }

  const service = req.scope.resolve(
    PROCUREMENT_MODULE,
  ) as ProcurementModuleService;

  const po = await service.retrievePurchaseOrder(id, { relations: ["lines"] });
  if (po.status === "closed" || po.status === "canceled") {
    res
      .status(409)
      .json({ message: `Cannot edit lines on a ${po.status} PO` });
    return;
  }

  const line = (po.lines ?? []).find(
    (l: { id: string }) => l.id === lineId,
  ) as { id: string; qty_received: number } | undefined;
  if (!line) {
    res.status(404).json({ message: "Line not found on this PO" });
    return;
  }

  if (
    body.qty_ordered !== undefined &&
    body.qty_ordered < line.qty_received
  ) {
    res.status(409).json({
      message: `qty_ordered (${body.qty_ordered}) cannot drop below qty_received (${line.qty_received})`,
    });
    return;
  }

  const update: Record<string, unknown> = { id: lineId };
  if (body.qty_ordered !== undefined) update.qty_ordered = body.qty_ordered;
  if (body.unit_cost !== undefined) update.unit_cost = body.unit_cost;

  await service.updatePurchaseOrderLines(update);

  const purchase_order = await service.retrievePurchaseOrder(id, {
    relations: ["lines", "supplier", "adjustments"],
  });
  const landed_costs = await service.computeLandedUnitCosts(id);
  res.json({ purchase_order, landed_costs });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id, lineId } = req.params as { id: string; lineId: string };

  const service = req.scope.resolve(
    PROCUREMENT_MODULE,
  ) as ProcurementModuleService;

  const po = await service.retrievePurchaseOrder(id, { relations: ["lines"] });
  if (po.status === "closed" || po.status === "canceled") {
    res
      .status(409)
      .json({ message: `Cannot delete lines on a ${po.status} PO` });
    return;
  }

  const line = (po.lines ?? []).find(
    (l: { id: string }) => l.id === lineId,
  ) as { id: string; qty_received: number } | undefined;
  if (!line) {
    res.status(404).json({ message: "Line not found on this PO" });
    return;
  }
  if (line.qty_received > 0) {
    res.status(409).json({
      message:
        "Cannot delete a line with received quantity — the lots already exist in inventory",
    });
    return;
  }

  await service.deletePurchaseOrderLines(lineId);

  const purchase_order = await service.retrievePurchaseOrder(id, {
    relations: ["lines", "supplier", "adjustments"],
  });
  const landed_costs = await service.computeLandedUnitCosts(id);
  res.json({ purchase_order, landed_costs });
};
