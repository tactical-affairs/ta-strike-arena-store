import { model } from "@medusajs/framework/utils";

/**
 * One batch of inventory received at a specific cost. The FIFO queue
 * for a given SKU is the set of `active` lots with qty_remaining > 0,
 * ordered by received_at ascending.
 *
 * Status transitions:
 *   active → exhausted (qty_remaining hits 0 via customer orders)
 *   active → damaged   (set at return receipt when condition=damaged;
 *                       never consumed, tracked for loss reporting)
 *
 * `inventory_item_id` links to the core Medusa inventory_item via
 * src/links/inventory-lot-inventory-item.ts. `po_line_id` is a
 * soft reference — when a lot originates from a PO we store the line
 * id here for traceability; returns create lots without a po_line_id.
 */
export const InventoryLot = model.define("inventory_lot", {
  id: model.id({ prefix: "lot" }).primaryKey(),
  inventory_item_id: model.text(),
  po_line_id: model.text().nullable(),
  location_id: model.text(),
  qty_initial: model.number(),
  qty_remaining: model.number(),
  unit_cost: model.bigNumber(),
  currency: model.text().default("usd"),
  received_at: model.dateTime(),
  status: model
    .enum(["active", "exhausted", "damaged"])
    .default("active"),
  source: model.enum(["po", "return_restock", "opening_balance"]).default("po"),
  metadata: model.json().nullable(),
});

export default InventoryLot;
