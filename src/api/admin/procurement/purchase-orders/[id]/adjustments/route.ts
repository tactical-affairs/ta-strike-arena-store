/**
 * Admin API: add or delete PO-level adjustments (shipping, discount,
 * tariff, other). Used when the shipping invoice arrives after PO
 * creation, or ops needs to record a supplier discount not captured
 * up front.
 *
 * POST   /admin/procurement/purchase-orders/:id/adjustments
 * DELETE /admin/procurement/purchase-orders/:id/adjustments?adjustment_id=...
 *
 * NOTE: edits affect only lots created AFTER the adjustment is added.
 * Lots already received keep their original landed cost. This mirrors
 * accounting practice — you don't rewrite history, you absorb the
 * variance into future receipts or post a manual journal adjustment.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { PROCUREMENT_MODULE } from "../../../../../../modules/procurement";
import type ProcurementModuleService from "../../../../../../modules/procurement/service";

type AddAdjustmentBody = {
  type: "shipping" | "discount" | "tariff" | "other";
  amount: number;
  notes?: string;
};

export const POST = async (
  req: MedusaRequest<AddAdjustmentBody>,
  res: MedusaResponse,
) => {
  const { id } = req.params as { id: string };
  const body = req.body;

  if (!body?.type || typeof body.amount !== "number") {
    res.status(400).json({ message: "type and amount are required" });
    return;
  }

  const service = req.scope.resolve(
    PROCUREMENT_MODULE,
  ) as ProcurementModuleService;

  const adjustment = await service.createPoAdjustments({
    purchase_order_id: id,
    type: body.type,
    amount: body.amount,
    notes: body.notes ?? null,
  });

  const purchase_order = await service.retrievePurchaseOrder(id, {
    relations: ["lines", "supplier", "adjustments"],
  });
  const landed_costs = await service.computeLandedUnitCosts(id);
  res.json({ adjustment, purchase_order, landed_costs });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params as { id: string };
  const adjustmentId = String(req.query.adjustment_id ?? "");
  if (!adjustmentId) {
    res.status(400).json({ message: "adjustment_id query param required" });
    return;
  }

  const service = req.scope.resolve(
    PROCUREMENT_MODULE,
  ) as ProcurementModuleService;
  await service.deletePoAdjustments(adjustmentId);

  const purchase_order = await service.retrievePurchaseOrder(id, {
    relations: ["lines", "supplier", "adjustments"],
  });
  const landed_costs = await service.computeLandedUnitCosts(id);
  res.json({ purchase_order, landed_costs });
};
