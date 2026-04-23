/**
 * Admin API: list + create suppliers.
 *
 * GET  /admin/procurement/suppliers       → { suppliers: [...] }
 * POST /admin/procurement/suppliers       → { supplier: {...} }
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { PROCUREMENT_MODULE } from "../../../../modules/procurement";
import type ProcurementModuleService from "../../../../modules/procurement/service";

type CreateSupplierBody = {
  name: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  default_currency?: string;
  lead_time_days?: number;
  notes?: string;
};

export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
  const service = req.scope.resolve(
    PROCUREMENT_MODULE,
  ) as ProcurementModuleService;
  const suppliers = await service.listSuppliers(
    {},
    { order: { name: "ASC" } },
  );
  res.json({ suppliers });
};

export const POST = async (
  req: MedusaRequest<CreateSupplierBody>,
  res: MedusaResponse,
) => {
  const body = req.body;
  if (!body?.name?.trim()) {
    res.status(400).json({ message: "name is required" });
    return;
  }
  const service = req.scope.resolve(
    PROCUREMENT_MODULE,
  ) as ProcurementModuleService;
  const supplier = await service.createSuppliers({
    name: body.name.trim(),
    contact_name: body.contact_name ?? null,
    email: body.email ?? null,
    phone: body.phone ?? null,
    default_currency: body.default_currency ?? "usd",
    lead_time_days: body.lead_time_days ?? null,
    notes: body.notes ?? null,
  });
  res.json({ supplier });
};
