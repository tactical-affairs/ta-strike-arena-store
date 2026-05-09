import { model } from "@medusajs/framework/utils";

/**
 * One customer's request to be emailed when a specific variant comes
 * back in stock. `notified_at` flips to a timestamp once the email goes
 * out — pending rows have it null. The (email, variant_id) pair is
 * unique across pending rows so duplicate clicks don't queue duplicate
 * emails; once notified, the same customer can resubscribe later if
 * stock drops to zero again.
 */
export const BackInStockSubscription = model
  .define("back_in_stock_subscription", {
    id: model.id({ prefix: "bis" }).primaryKey(),
    email: model.text().searchable(),
    variant_id: model.text(),
    notified_at: model.dateTime().nullable(),
  })
  .indexes([
    { on: ["variant_id"] },
    { on: ["email"] },
    {
      on: ["email", "variant_id"],
      unique: true,
      where: "notified_at IS NULL",
    },
  ]);

export default BackInStockSubscription;
