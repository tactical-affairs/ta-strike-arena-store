/**
 * Admin API: purchase-order detail.
 *
 * GET   /admin/procurement/purchase-orders/:id → { purchase_order, landed_costs }
 * PATCH /admin/procurement/purchase-orders/:id → { purchase_order, landed_costs }
 *   body: { po_number?, supplier_id?, expected_at?, notes?, status? }
 *   - po_number: must be unique across all POs; collisions return 409.
 *   - status: only "canceled" is accepted; other transitions are managed by the
 *     receive flow. Cancellation is rejected if any line has qty_received > 0.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { PROCUREMENT_MODULE } from "../../../../../modules/procurement";
import type ProcurementModuleService from "../../../../../modules/procurement/service";

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve(
    PROCUREMENT_MODULE,
  ) as ProcurementModuleService;
  const { id } = req.params as { id: string };
  const purchase_order = await service.retrievePurchaseOrder(id, {
    relations: ["lines", "supplier", "adjustments"],
  });
  const landed_costs = await service.computeLandedUnitCosts(id);
  res.json({ purchase_order, landed_costs });
};

type PatchBody = {
  po_number?: string;
  supplier_id?: string;
  expected_at?: string | null;
  notes?: string | null;
  status?: "canceled";
};

export const PATCH = async (req: MedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve(
    PROCUREMENT_MODULE,
  ) as ProcurementModuleService;
  const { id } = req.params as { id: string };
  const body = (req.body ?? {}) as PatchBody;

  const current = await service.retrievePurchaseOrder(id, {
    relations: ["lines"],
  });

  if (current.status === "canceled" || current.status === "closed") {
    res.status(409).json({
      message: `Cannot edit a ${current.status} purchase order`,
    });
    return;
  }

  if (body.status !== undefined && body.status !== "canceled") {
    res.status(400).json({
      message: "status can only be set to 'canceled' via this endpoint",
    });
    return;
  }

  if (body.status === "canceled") {
    const hasReceipts = (current.lines ?? []).some(
      (l: { qty_received: number }) => l.qty_received > 0,
    );
    if (hasReceipts) {
      res.status(409).json({
        message: "Cannot cancel a PO that has already received items",
      });
      return;
    }
  }

  const update: Record<string, unknown> = { id };
  if (Object.prototype.hasOwnProperty.call(body, "po_number")) {
    const trimmed = (body.po_number ?? "").trim();
    if (!trimmed) {
      res.status(400).json({ message: "po_number cannot be empty" });
      return;
    }
    update.po_number = trimmed;
  }
  if (Object.prototype.hasOwnProperty.call(body, "supplier_id")) {
    update.supplier_id = body.supplier_id || null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "expected_at")) {
    update.expected_at = body.expected_at ? new Date(body.expected_at) : null;
  }
  if (Object.prototype.hasOwnProperty.call(body, "notes")) {
    update.notes = body.notes ?? null;
  }
  if (body.status === "canceled") {
    update.status = "canceled";
  }

  try {
    await service.updatePurchaseOrders(update);
  } catch (err: unknown) {
    // Postgres unique-violation surface as 23505 from the underlying driver.
    const code = (err as { code?: string })?.code;
    const message = (err as { message?: string })?.message ?? "";
    if (code === "23505" || /unique|duplicate/i.test(message)) {
      res.status(409).json({
        message: `PO number "${update.po_number}" is already in use`,
      });
      return;
    }
    throw err;
  }

  const purchase_order = await service.retrievePurchaseOrder(id, {
    relations: ["lines", "supplier", "adjustments"],
  });
  const landed_costs = await service.computeLandedUnitCosts(id);
  res.json({ purchase_order, landed_costs });
};
