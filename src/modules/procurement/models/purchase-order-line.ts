import { model } from "@medusajs/framework/utils";
import { PurchaseOrder } from "./purchase-order";

/**
 * One line on a PO. `variant_id` is the target Medusa product variant
 * (linked externally via src/links/po-line-variant.ts). When the line
 * is received (partially or fully), the receive workflow creates
 * InventoryLot rows and bumps `qty_received` here.
 */
export const PurchaseOrderLine = model.define("po_line", {
  id: model.id({ prefix: "poline" }).primaryKey(),
  variant_id: model.text(),
  qty_ordered: model.number(),
  qty_received: model.number().default(0),
  unit_cost: model.bigNumber(),
  currency: model.text().default("usd"),
  metadata: model.json().nullable(),
  purchase_order: model.belongsTo(() => PurchaseOrder, { mappedBy: "lines" }),
});

export default PurchaseOrderLine;
