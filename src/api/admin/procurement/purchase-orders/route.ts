/**
 * Admin API: list + create purchase orders.
 *
 * GET  /admin/procurement/purchase-orders       → { purchase_orders: [...] }
 * POST /admin/procurement/purchase-orders       → { purchase_order: {...} }
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { PROCUREMENT_MODULE } from "../../../../modules/procurement";
import type ProcurementModuleService from "../../../../modules/procurement/service";
import type { CreatePurchaseOrderInput } from "../../../../modules/procurement/service";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve(
    PROCUREMENT_MODULE,
  ) as ProcurementModuleService;
  const purchase_orders = await service.listPurchaseOrders(
    {},
    {
      relations: ["lines", "supplier"],
      order: { ordered_at: "DESC" },
    },
  );
  res.json({ purchase_orders });
};

export const POST = async (
  req: MedusaRequest<CreatePurchaseOrderInput>,
  res: MedusaResponse,
) => {
  const body = req.body;
  if (!body?.supplier_id) {
    res.status(400).json({ message: "supplier_id is required" });
    return;
  }
  if (!body.lines?.length) {
    res
      .status(400)
      .json({ message: "purchase order must have at least one line" });
    return;
  }

  const service = req.scope.resolve(
    PROCUREMENT_MODULE,
  ) as ProcurementModuleService;

  const { id } = await service.createPurchaseOrderWithLines({
    ...body,
    created_by: body.created_by,
  });
  const purchase_order = await service.retrievePurchaseOrder(id, {
    relations: ["lines", "supplier"],
  });
  res.json({ purchase_order });
};
