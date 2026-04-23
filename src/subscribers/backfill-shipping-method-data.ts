/**
 * Backfill `cart_shipping_method.data` from the related
 * `shipping_option.data`.
 *
 * Problem: when the storefront calls
 * `POST /store/carts/:id/shipping-methods` with just an `option_id`,
 * Medusa v2's default flow creates the shipping_method row but
 * leaves its `data` column empty. Our Shippo fulfillment provider
 * reads that `data` to identify which carrier/service to book, so
 * an empty value breaks label purchase at fulfillment time.
 *
 * Fix: listen for `cart.updated`, look for methods with missing
 * data, and copy the option's data in. Early-bail when nothing
 * needs patching so the extra work is cheap on unrelated cart
 * updates (line item changes, address edits, etc.).
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";

export default async function backfillShippingMethodData({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const cartService = container.resolve(Modules.CART) as unknown as {
    updateShippingMethods: (
      input: { id: string; data: Record<string, unknown> },
    ) => Promise<unknown>;
  };
  const logger = container.resolve("logger");

  const { data: carts } = await query.graph({
    entity: "cart",
    fields: [
      "id",
      "shipping_methods.id",
      "shipping_methods.shipping_option_id",
      "shipping_methods.data",
    ],
    filters: { id: data.id } as never,
  });
  const cart = carts[0] as
    | {
        id: string;
        shipping_methods?: Array<{
          id: string;
          shipping_option_id?: string | null;
          data?: Record<string, unknown> | null;
        }>;
      }
    | undefined;
  if (!cart) return;

  const needsBackfill = (cart.shipping_methods ?? []).filter(
    (m) =>
      !!m.shipping_option_id &&
      (!m.data || Object.keys(m.data).length === 0),
  );
  if (needsBackfill.length === 0) return;

  for (const method of needsBackfill) {
    try {
      const { data: options } = await query.graph({
        entity: "shipping_option",
        fields: ["id", "data"],
        filters: { id: method.shipping_option_id! } as never,
      });
      const optionData = (options[0] as { data?: Record<string, unknown> } | undefined)
        ?.data;
      if (!optionData || Object.keys(optionData).length === 0) continue;

      await cartService.updateShippingMethods({
        id: method.id,
        data: optionData,
      });
      logger.info(
        `[backfill-shipping-method-data] cart=${cart.id} method=${method.id} data=${JSON.stringify(optionData)}`,
      );
    } catch (err) {
      logger.error(
        `[backfill-shipping-method-data] failed for method ${method.id}: ${(err as Error).message}`,
      );
    }
  }
}

export const config: SubscriberConfig = {
  event: "cart.updated",
};
