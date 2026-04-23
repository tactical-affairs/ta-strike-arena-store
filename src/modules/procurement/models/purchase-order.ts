import { model } from "@medusajs/framework/utils";
import { Supplier } from "./supplier";
import { PurchaseOrderLine } from "./purchase-order-line";
import { PoAdjustment } from "./po-adjustment";

/**
 * A purchase order to a supplier. Goes through draft → submitted →
 * partial → closed. `canceled` is terminal.
 */
export const PurchaseOrder = model.define("purchase_order", {
  id: model.id({ prefix: "po" }).primaryKey(),
  po_number: model.text().searchable().unique(),
  status: model
    .enum(["draft", "submitted", "partial", "closed", "canceled"])
    .default("draft"),
  ordered_at: model.dateTime().nullable(),
  expected_at: model.dateTime().nullable(),
  notes: model.text().nullable(),
  created_by: model.text().nullable(),
  metadata: model.json().nullable(),
  supplier: model.belongsTo(() => Supplier),
  lines: model.hasMany(() => PurchaseOrderLine, { mappedBy: "purchase_order" }),
  adjustments: model.hasMany(() => PoAdjustment, {
    mappedBy: "purchase_order",
  }),
});

export default PurchaseOrder;
