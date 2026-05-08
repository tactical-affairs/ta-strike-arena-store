/**
 * Shipment notification email — fires on order.shipment_created.
 *
 * Loads the fulfillment to grab tracking_links + carrier, and the
 * order for display_id + email + items, then dispatches via the
 * notification module. The aws-ses provider ships it through SES.
 *
 * Idempotency keyed on shipment id (per-fulfillment, since one order
 * can ship in multiple boxes).
 *
 * Failures logged but never thrown — flaky inbox shouldn't block
 * fulfillment workflows.
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";
import {
  buildOrderShippedHtml,
  buildOrderShippedText,
  type OrderShippedInput,
  type ShippedTrackingLink,
} from "../lib/email-templates/order-shipped";

type Payload = {
  id?: string;
  order_id?: string;
  fulfillment_id?: string;
};

type FulfillmentRow = {
  id: string;
  shipping_option?: { provider_id?: string | null } | null;
  labels?: Array<{ tracking_number?: string | null; tracking_url?: string | null } | null> | null;
  items?: Array<{
    line_item_id?: string | null;
    title?: string | null;
    quantity?: number | string | null;
  } | null> | null;
};

export default async function orderShippedEmailHandler({
  event: { data },
  container,
}: SubscriberArgs<Payload>) {
  const logger = container.resolve("logger");
  const orderModule = container.resolve(Modules.ORDER);
  const notificationModule = container.resolve(Modules.NOTIFICATION);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const fulfillmentId = data.fulfillment_id ?? data.id;
  const orderId = data.order_id ?? data.id;
  if (!fulfillmentId || !orderId) {
    logger.warn(
      `[order-shipped-email] missing fulfillment_id or order_id in event payload`,
    );
    return;
  }

  let fulfillment: FulfillmentRow | undefined;
  try {
    const { data: rows } = await query.graph({
      entity: "fulfillment",
      fields: [
        "id",
        "shipping_option.provider_id",
        "labels.tracking_number",
        "labels.tracking_url",
        "items.line_item_id",
        "items.title",
        "items.quantity",
      ],
      filters: { id: fulfillmentId },
    });
    fulfillment = rows[0] as FulfillmentRow | undefined;
  } catch (err) {
    logger.error(
      `[order-shipped-email] failed to load fulfillment ${fulfillmentId}: ${(err as Error).message}`,
    );
    return;
  }
  if (!fulfillment) {
    logger.warn(
      `[order-shipped-email] fulfillment ${fulfillmentId} not found`,
    );
    return;
  }

  let order: Record<string, unknown>;
  try {
    order = (await orderModule.retrieveOrder(orderId, {
      relations: ["items"],
    })) as unknown as Record<string, unknown>;
  } catch (err) {
    logger.error(
      `[order-shipped-email] failed to retrieve order ${orderId}: ${(err as Error).message}`,
    );
    return;
  }

  const email = order.email as string | undefined;
  if (!email) {
    logger.warn(`[order-shipped-email] order ${orderId} has no email; skipping`);
    return;
  }

  const trackingLinks: ShippedTrackingLink[] = (fulfillment.labels ?? [])
    .filter((l): l is NonNullable<typeof l> => !!l)
    .map((l) => ({
      tracking_number: l.tracking_number,
      url: l.tracking_url,
    }));

  // Resolve carrier from shipping_option.provider_id (e.g. "shippo_ups", "manual_manual").
  const providerId = fulfillment.shipping_option?.provider_id ?? null;
  const carrier = providerId
    ? providerId
        .replace(/^shippo_/, "")
        .replace(/^manual_.*/, "Manual")
        .toUpperCase()
    : null;

  // Map fulfillment items back to product titles via the order's items.
  const orderItems = (order.items ?? []) as Array<{
    id: string;
    title?: string | null;
    product_title?: string | null;
    variant_title?: string | null;
  }>;
  const itemsByLineId = new Map(orderItems.map((it) => [it.id, it]));
  const items: OrderShippedInput["items"] = (fulfillment.items ?? [])
    .filter((i): i is NonNullable<typeof i> => !!i?.line_item_id)
    .map((i) => {
      const orderItem = itemsByLineId.get(i.line_item_id!);
      return {
        title: i.title ?? orderItem?.title ?? null,
        product_title: orderItem?.product_title ?? null,
        variant_title: orderItem?.variant_title ?? null,
        quantity: Number(i.quantity ?? 0),
      };
    });

  const input: OrderShippedInput = {
    display_id: order.display_id as number | string,
    email,
    carrier,
    tracking_links: trackingLinks,
    items,
  };

  try {
    await notificationModule.createNotifications({
      to: email,
      channel: "email",
      template: "order-shipped",
      idempotency_key: `order-shipped:${fulfillmentId}`,
      content: {
        subject: `Order #${input.display_id} shipped — Strike Arena`,
        html: buildOrderShippedHtml(input),
        text: buildOrderShippedText(input),
      },
      data: {
        order_id: orderId,
        fulfillment_id: fulfillmentId,
        display_id: input.display_id,
      },
    });
    logger.info(
      `[order-shipped-email] sent shipment notification for order ${input.display_id} (fulfillment ${fulfillmentId}) to ${email}`,
    );
  } catch (err) {
    logger.error(
      `[order-shipped-email] failed to send for order ${orderId} to ${email}: ${(err as Error).message}`,
    );
  }
}

export const config: SubscriberConfig = {
  event: "order.shipment_created",
};
