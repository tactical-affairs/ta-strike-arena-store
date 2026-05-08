/**
 * Order confirmation email — fires on order.placed.
 *
 * Loads the order with items + shipping address, builds an HTML/text
 * email, and dispatches via the notification module. The aws-ses
 * provider then ships the message through SES SMTP.
 *
 * Idempotency: notifications carry the order id as idempotency_key, so
 * if the event is delivered twice (worker retry, etc.) Medusa skips
 * the second send.
 *
 * Failures are logged but never thrown — a flaky inbox shouldn't
 * cause the order workflow to retry/fail.
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";
import {
  buildOrderPlacedHtml,
  buildOrderPlacedText,
  type OrderPlacedInput,
} from "../lib/email-templates/order-placed";

export default async function orderPlacedEmailHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger");
  const notificationModule = container.resolve(Modules.NOTIFICATION);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  // Money totals on Medusa v2 orders are computed only when listed in `fields` —
  // retrieveOrder() with `relations` alone returns null/0 for total/shipping/tax.
  let order: Record<string, unknown> | undefined;
  try {
    const { data: rows } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "email",
        "currency_code",
        "subtotal",
        "shipping_total",
        "tax_total",
        "total",
        "items.*",
        "shipping_address.*",
      ],
      filters: { id: data.id },
    });
    order = rows[0] as Record<string, unknown> | undefined;
  } catch (err) {
    logger.error(
      `[order-placed-email] failed to load order ${data.id}: ${(err as Error).message}`,
    );
    return;
  }
  if (!order) {
    logger.warn(`[order-placed-email] order ${data.id} not found`);
    return;
  }

  const email = order.email as string | undefined;
  if (!email) {
    logger.warn(
      `[order-placed-email] order ${data.id} has no email; skipping`,
    );
    return;
  }

  const input: OrderPlacedInput = {
    display_id: order.display_id as number | string,
    email,
    currency_code: order.currency_code as string | undefined,
    items: (order.items as OrderPlacedInput["items"]) ?? [],
    shipping_address: order.shipping_address as
      | OrderPlacedInput["shipping_address"]
      | null,
    subtotal: order.subtotal as number | string | null,
    shipping_total: order.shipping_total as number | string | null,
    tax_total: order.tax_total as number | string | null,
    total: (order.total ?? 0) as number | string,
  };

  try {
    await notificationModule.createNotifications({
      to: email,
      channel: "email",
      template: "order-placed",
      idempotency_key: `order-placed:${order.id}`,
      content: {
        subject: `Order #${input.display_id} confirmed — Strike Arena`,
        html: buildOrderPlacedHtml(input),
        text: buildOrderPlacedText(input),
      },
      data: {
        order_id: order.id,
        display_id: input.display_id,
      },
    });
    logger.info(
      `[order-placed-email] sent confirmation for order ${input.display_id} to ${email}`,
    );
  } catch (err) {
    logger.error(
      `[order-placed-email] failed to send for order ${data.id} to ${email}: ${(err as Error).message}`,
    );
  }
}

export const config: SubscriberConfig = {
  event: "order.placed",
};
