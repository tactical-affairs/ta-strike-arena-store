import { model } from "@medusajs/framework/utils";

/**
 * A COGS posting: when `qty` units were consumed from `lot_id`, at
 * `unit_cost`, producing `total_cost` of COGS.
 *
 * `reason` distinguishes ordinary sales (the default) from non-sales
 * consumption like demos, samples, write-offs. Sales fill in
 * `order_id` + `order_line_item_id`; non-sales reasons leave them null.
 *
 * One order line item / one issue may produce multiple CogsEntry rows
 * if the consumed quantity spans multiple FIFO lots.
 *
 * On return: `reversed_at` is set (the entry stays in the ledger for
 * traceability); a new InventoryLot of source=return_restock is
 * created if the returned goods are resellable.
 *
 * `order_line_item_id` links to Medusa's order_item via
 * src/links/cogs-entry-order-line-item.ts (only when the link exists).
 */
export const CogsEntry = model.define("cogs_entry", {
  id: model.id({ prefix: "cogs" }).primaryKey(),
  reason: model
    .enum([
      "sale",
      "demo",
      "sample",
      "internal_use",
      "damaged_post_receipt",
      "write_off",
    ])
    .default("sale"),
  order_id: model.text().nullable(),
  order_line_item_id: model.text().nullable(),
  lot_id: model.text(),
  qty: model.number(),
  unit_cost: model.bigNumber(),
  total_cost: model.bigNumber(),
  currency: model.text().default("usd"),
  notes: model.text().nullable(),
  posted_at: model.dateTime(),
  reversed_at: model.dateTime().nullable(),
  metadata: model.json().nullable(),
});

export default CogsEntry;
