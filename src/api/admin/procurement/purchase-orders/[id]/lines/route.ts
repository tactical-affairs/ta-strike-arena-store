/**
 * Admin API: add a line to an existing purchase order.
 *
 * POST /admin/procurement/purchase-orders/:id/lines
 *   body: { variant_id, qty_ordered, unit_cost, currency? }
 *
 * Refused once the PO is closed or canceled. Adding lines is fine on a
 * partially-received PO — the new line just needs to be received like
 * any other.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { PROCUREMENT_MODULE } from "../../../../../../modules/procurement";
import type ProcurementModuleService from "../../../../../../modules/procurement/service";

type AddLineBody = {
  variant_id: string;
  qty_ordered: number;
  unit_cost: number;
  currency?: string;
};

export const POST = async (
  req: MedusaRequest<AddLineBody>,
  res: MedusaResponse,
) => {
  const { id } = req.params as { id: string };
  const body = req.body ?? ({} as AddLineBody);

  if (
    !body.variant_id ||
    typeof body.qty_ordered !== "number" ||
    typeof body.unit_cost !== "number"
  ) {
    res
      .status(400)
      .json({ message: "variant_id, qty_ordered, unit_cost are required" });
    return;
  }
  if (body.qty_ordered <= 0 || body.unit_cost < 0) {
    res
      .status(400)
      .json({ message: "qty_ordered must be > 0 and unit_cost must be ≥ 0" });
    return;
  }

  const service = req.scope.resolve(
    PROCUREMENT_MODULE,
  ) as ProcurementModuleService;

  const po = await service.retrievePurchaseOrder(id);
  if (po.status === "closed" || po.status === "canceled") {
    res
      .status(409)
      .json({ message: `Cannot add lines to a ${po.status} PO` });
    return;
  }

  await service.createPurchaseOrderLines([
    {
      purchase_order_id: id,
      variant_id: body.variant_id,
      qty_ordered: body.qty_ordered,
      qty_received: 0,
      unit_cost: body.unit_cost,
      currency: body.currency ?? "usd",
    },
  ]);

  const purchase_order = await service.retrievePurchaseOrder(id, {
    relations: ["lines", "supplier", "adjustments"],
  });
  const landed_costs = await service.computeLandedUnitCosts(id);
  res.json({ purchase_order, landed_costs });
};
