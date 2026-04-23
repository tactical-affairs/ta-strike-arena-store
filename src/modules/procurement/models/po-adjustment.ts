import { model } from "@medusajs/framework/utils";
import { PurchaseOrder } from "./purchase-order";

/**
 * PO-level adjustment: shipping, discount, tariff, or other. These
 * are allocated across inventory lines at receive time by extended
 * value (qty_ordered × unit_cost), and the allocated share is baked
 * into each created InventoryLot's unit_cost so COGS reporting
 * reflects true landed cost — not just the supplier's line quote.
 *
 * `amount` is signed:
 *   - shipping / tariff / other: positive (increases landed cost)
 *   - discount: negative (decreases landed cost)
 *
 * The UI can enforce sign based on type, but the model stores the
 * raw number so a negative "shipping refund" or positive "discount
 * reversal" are both representable.
 */
export const PoAdjustment = model.define("po_adjustment", {
  id: model.id({ prefix: "poadj" }).primaryKey(),
  type: model
    .enum(["shipping", "discount", "tariff", "other"])
    .default("shipping"),
  amount: model.bigNumber(),
  currency: model.text().default("usd"),
  notes: model.text().nullable(),
  metadata: model.json().nullable(),
  purchase_order: model.belongsTo(() => PurchaseOrder, {
    mappedBy: "adjustments",
  }),
});

export default PoAdjustment;
