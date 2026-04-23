import { model } from "@medusajs/framework/utils";

/**
 * A COGS posting: when `qty` units were consumed from `lot_id` to
 * fulfill `order_line_item_id`, at `unit_cost`, producing
 * `total_cost` of COGS.
 *
 * One order line item may produce multiple CogsEntry rows if the
 * fulfilled quantity spans multiple FIFO lots.
 *
 * On return: `reversed_at` is set (the entry stays in the ledger for
 * traceability); a new InventoryLot of source=return_restock is
 * created if the returned goods are resellable.
 *
 * `order_line_item_id` links to Medusa's order_item via
 * src/links/cogs-entry-order-line-item.ts.
 */
export const CogsEntry = model.define("cogs_entry", {
  id: model.id({ prefix: "cogs" }).primaryKey(),
  order_id: model.text(),
  order_line_item_id: model.text(),
  lot_id: model.text(),
  qty: model.number(),
  unit_cost: model.bigNumber(),
  total_cost: model.bigNumber(),
  currency: model.text().default("usd"),
  posted_at: model.dateTime(),
  reversed_at: model.dateTime().nullable(),
  metadata: model.json().nullable(),
});

export default CogsEntry;
