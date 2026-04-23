import { model } from "@medusajs/framework/utils";

/**
 * Supplier we buy from. Lightweight contact record — anything more
 * complex (net terms, AP history, 1099 data) lives in the accountant's
 * QuickBooks, not here.
 */
export const Supplier = model.define("supplier", {
  id: model.id({ prefix: "sup" }).primaryKey(),
  name: model.text().searchable(),
  contact_name: model.text().nullable(),
  email: model.text().nullable(),
  phone: model.text().nullable(),
  default_currency: model.text().default("usd"),
  lead_time_days: model.number().nullable(),
  notes: model.text().nullable(),
  metadata: model.json().nullable(),
});

export default Supplier;
