/**
 * When an order is placed by a guest, Medusa creates a customer record
 * keyed by email but leaves first_name/last_name/phone blank AND does
 * not copy the order addresses into the customer's address book. The
 * Admin UI then shows an "empty" customer even though the order has
 * full shipping + billing info.
 *
 * This subscriber:
 *   1. Fills first_name / last_name / phone on the customer from the
 *      order's billing address (falls back to shipping if billing is
 *      missing). Only writes when the target field is empty — won't
 *      overwrite a name a returning customer set themselves.
 *   2. If the customer has no addresses in their book yet, copies the
 *      billing address as is_default_billing and (if different) the
 *      shipping address as is_default_shipping.
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import type { CreateCustomerAddressDTO } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

type OrderAddress = {
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
  company?: string | null;
  address_1?: string | null;
  address_2?: string | null;
  city?: string | null;
  province?: string | null;
  postal_code?: string | null;
  country_code?: string | null;
};

function sameAddress(
  a: OrderAddress | null | undefined,
  b: OrderAddress | null | undefined,
): boolean {
  if (!a || !b) return false;
  return (
    a.address_1 === b.address_1 &&
    a.address_2 === b.address_2 &&
    a.city === b.city &&
    a.province === b.province &&
    a.postal_code === b.postal_code &&
    a.country_code === b.country_code
  );
}

function toCustomerAddress(
  customerId: string,
  src: OrderAddress,
  flags: { is_default_billing?: boolean; is_default_shipping?: boolean },
  addressName: string,
): CreateCustomerAddressDTO {
  return {
    customer_id: customerId,
    address_name: addressName,
    first_name: src.first_name ?? null,
    last_name: src.last_name ?? null,
    company: src.company ?? null,
    address_1: src.address_1 ?? null,
    address_2: src.address_2 ?? null,
    city: src.city ?? null,
    province: src.province ?? null,
    postal_code: src.postal_code ?? null,
    country_code: src.country_code ?? null,
    phone: src.phone ?? null,
    ...flags,
  };
}

export default async function populateCustomerFromOrder({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderService = container.resolve(Modules.ORDER);
  const customerService = container.resolve(Modules.CUSTOMER);
  const logger = container.resolve("logger");

  const order = await orderService.retrieveOrder(data.id, {
    relations: ["shipping_address", "billing_address"],
  });

  if (!order.customer_id) return;

  const customer = await customerService.retrieveCustomer(order.customer_id, {
    relations: ["addresses"],
  });

  const billing = (order.billing_address ?? null) as OrderAddress | null;
  const shipping = (order.shipping_address ?? null) as OrderAddress | null;
  const primary = billing ?? shipping;

  // 1) Fill name/phone if the customer record is still blank.
  const patch: Record<string, string> = {};
  if (primary) {
    if (!customer.first_name && primary.first_name) {
      patch.first_name = primary.first_name;
    }
    if (!customer.last_name && primary.last_name) {
      patch.last_name = primary.last_name;
    }
    if (!customer.phone && primary.phone) {
      patch.phone = primary.phone;
    }
  }
  if (Object.keys(patch).length > 0) {
    await customerService.updateCustomers(order.customer_id, patch);
  }

  // 2) Seed the address book on first order.
  const existingAddresses = customer.addresses ?? [];
  if (existingAddresses.length === 0) {
    const toCreate: CreateCustomerAddressDTO[] = [];
    const shippingMatchesBilling = sameAddress(billing, shipping);

    if (billing?.address_1) {
      toCreate.push(
        toCustomerAddress(
          order.customer_id,
          billing,
          {
            is_default_billing: true,
            is_default_shipping: shippingMatchesBilling,
          },
          "Billing",
        ),
      );
    }
    if (shipping?.address_1 && !shippingMatchesBilling) {
      toCreate.push(
        toCustomerAddress(
          order.customer_id,
          shipping,
          { is_default_shipping: true },
          "Shipping",
        ),
      );
    }
    if (toCreate.length > 0) {
      await customerService.createCustomerAddresses(toCreate);
    }
  }

  const summary: string[] = [];
  if (Object.keys(patch).length > 0) {
    summary.push(`profile=${Object.keys(patch).join("+")}`);
  }
  if (existingAddresses.length === 0) {
    summary.push("addresses=seeded");
  }
  if (summary.length > 0) {
    logger.info(
      `[populate-customer-from-order] customer ${order.customer_id} ← order ${data.id} ${summary.join(" ")}`,
    );
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
};
