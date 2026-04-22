/**
 * When an order is placed by a guest, Medusa creates a customer record
 * keyed by email but leaves first_name/last_name/phone blank. This
 * subscriber copies those fields from the order's shipping_address so
 * the customer profile in Medusa Admin shows a real person instead of
 * just an email.
 *
 * Only writes when the target field is empty — won't overwrite a name a
 * returning customer already set themselves.
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { Modules } from "@medusajs/framework/utils";

export default async function populateCustomerFromOrder({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderService = container.resolve(Modules.ORDER);
  const customerService = container.resolve(Modules.CUSTOMER);
  const logger = container.resolve("logger");

  const order = await orderService.retrieveOrder(data.id, {
    relations: ["shipping_address"],
  });

  if (!order.customer_id || !order.shipping_address) return;

  const customer = await customerService.retrieveCustomer(order.customer_id);
  const sa = order.shipping_address;

  const patch: Record<string, string> = {};
  if (!customer.first_name && sa.first_name) patch.first_name = sa.first_name;
  if (!customer.last_name && sa.last_name) patch.last_name = sa.last_name;
  if (!customer.phone && sa.phone) patch.phone = sa.phone;

  if (Object.keys(patch).length === 0) return;

  await customerService.updateCustomers(order.customer_id, patch);
  logger.info(
    `[populate-customer-from-order] Filled ${Object.keys(patch).join(", ")} on customer ${order.customer_id} from order ${data.id}`
  );
}

export const config: SubscriberConfig = {
  event: "order.placed",
};
