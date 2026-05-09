/**
 * Store API: subscribe to back-in-stock notifications.
 *
 * POST /store/back-in-stock
 *   Body: { email: string, variant_id: string }
 *   Returns 200 { id, created } when queued, or 200 { inStock: true }
 *   when the variant already has stock (no point subscribing).
 *
 * The website's notify form proxies to this route. Idempotent: a
 * pending row for the same (email, variant_id) is reused, so repeated
 * clicks don't duplicate.
 */

import type { MedusaRequest, MedusaResponse } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { BACK_IN_STOCK_MODULE } from "../../../modules/back-in-stock";
import type BackInStockModuleService from "../../../modules/back-in-stock/service";

type Body = {
  email?: string;
  variant_id?: string;
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST = async (
  req: MedusaRequest<Body>,
  res: MedusaResponse,
) => {
  const email = (req.body?.email ?? "").trim().toLowerCase();
  const variant_id = (req.body?.variant_id ?? "").trim();

  if (!email || !EMAIL_REGEX.test(email)) {
    res.status(400).json({ message: "Valid email is required" });
    return;
  }
  if (!variant_id) {
    res.status(400).json({ message: "variant_id is required" });
    return;
  }

  // Confirm the variant exists and check current inventory state. If the
  // variant is already buyable, don't queue — the customer can just buy.
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: variants } = await query.graph({
    entity: "variant",
    fields: ["id", "manage_inventory", "allow_backorder", "inventory_quantity"],
    filters: { id: variant_id },
  });
  const variant = variants[0] as unknown as
    | {
        id: string;
        manage_inventory: boolean;
        allow_backorder: boolean;
        inventory_quantity: number;
      }
    | undefined;

  if (!variant) {
    res.status(404).json({ message: "Variant not found" });
    return;
  }

  const inStock =
    !variant.manage_inventory ||
    variant.allow_backorder ||
    (variant.inventory_quantity ?? 0) > 0;
  if (inStock) {
    res.json({ inStock: true });
    return;
  }

  const service = req.scope.resolve(
    BACK_IN_STOCK_MODULE,
  ) as BackInStockModuleService;
  const result = await service.subscribe({ email, variant_id });
  res.json({ id: result.id, created: result.created, inStock: false });
};
