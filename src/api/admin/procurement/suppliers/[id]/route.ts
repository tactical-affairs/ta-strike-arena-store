/**
 * Admin API: get / update / delete a single supplier.
 *
 * GET    /admin/procurement/suppliers/:id   → { supplier }
 * PATCH  /admin/procurement/suppliers/:id   → { supplier }
 * DELETE /admin/procurement/suppliers/:id   → { id, deleted: true }
 *
 * DELETE is a soft-delete — historical POs that reference this supplier
 * stay intact. Re-creating a supplier with the same name later is fine.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { PROCUREMENT_MODULE } from "../../../../../modules/procurement";
import type ProcurementModuleService from "../../../../../modules/procurement/service";

type UpdateSupplierBody = Partial<{
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  default_currency: string;
  lead_time_days: number | null;
  notes: string | null;
}>;

const resolveService = (req: MedusaRequest): ProcurementModuleService =>
  req.scope.resolve(PROCUREMENT_MODULE) as ProcurementModuleService;

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const supplier = await resolveService(req).retrieveSupplier(id);
  res.json({ supplier });
};

export const PATCH = async (
  req: MedusaRequest<UpdateSupplierBody>,
  res: MedusaResponse,
) => {
  const { id } = req.params;
  const body = req.body ?? {};
  if (body.name !== undefined && !body.name.trim()) {
    res.status(400).json({ message: "name cannot be empty" });
    return;
  }
  const service = resolveService(req);
  const updated = await service.updateSuppliers({
    id,
    ...(body.name !== undefined && { name: body.name.trim() }),
    ...(body.contact_name !== undefined && { contact_name: body.contact_name }),
    ...(body.email !== undefined && { email: body.email }),
    ...(body.phone !== undefined && { phone: body.phone }),
    ...(body.default_currency !== undefined && {
      default_currency: body.default_currency,
    }),
    ...(body.lead_time_days !== undefined && {
      lead_time_days: body.lead_time_days,
    }),
    ...(body.notes !== undefined && { notes: body.notes }),
  });
  // updateSuppliers returns the updated record(s); normalize to a single object
  const supplier = Array.isArray(updated) ? updated[0] : updated;
  res.json({ supplier });
};

export const DELETE = async (req: MedusaRequest, res: MedusaResponse) => {
  const { id } = req.params;
  const service = resolveService(req) as ProcurementModuleService & {
    softDeleteSuppliers: (ids: string[]) => Promise<unknown>;
  };
  await service.softDeleteSuppliers([id]);
  res.json({ id, deleted: true });
};
