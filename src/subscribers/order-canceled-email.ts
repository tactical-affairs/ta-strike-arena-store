/**
 * Order cancellation email — fires on order.canceled.
 *
 * Loads the order summary and dispatches a brief cancellation email.
 * Doesn't try to predict refund mechanics; the copy promises a follow-up
 * if a charge was already captured.
 *
 * Idempotency keyed on order id so re-cancel events don't double-send.
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";
import {
  buildOrderCanceledHtml,
  buildOrderCanceledText,
  type OrderCanceledInput,
} from "../lib/email-templates/order-canceled";

export default async function orderCanceledEmailHandler({
  event: { data },
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve("logger");
  const notificationModule = container.resolve(Modules.NOTIFICATION);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  let order: Record<string, unknown> | undefined;
  try {
    const { data: rows } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "email",
        "currency_code",
        "total",
        "canceled_at",
      ],
      filters: { id: data.id },
    });
    order = rows[0] as Record<string, unknown> | undefined;
  } catch (err) {
    logger.error(
      `[order-canceled-email] failed to load order ${data.id}: ${(err as Error).message}`,
    );
    return;
  }
  if (!order) {
    logger.warn(`[order-canceled-email] order ${data.id} not found`);
    return;
  }

  const email = order.email as string | undefined;
  if (!email) {
    logger.warn(
      `[order-canceled-email] order ${data.id} has no email; skipping`,
    );
    return;
  }

  const input: OrderCanceledInput = {
    display_id: order.display_id as number | string,
    email,
    currency_code: order.currency_code as string | undefined,
    total: (order.total ?? 0) as number | string,
    canceled_at: order.canceled_at as string | Date | null,
  };

  try {
    await notificationModule.createNotifications({
      to: email,
      channel: "email",
      template: "order-canceled",
      idempotency_key: `order-canceled:${order.id}`,
      content: {
        subject: `Order #${input.display_id} canceled — Strike Arena`,
        html: buildOrderCanceledHtml(input),
        text: buildOrderCanceledText(input),
      },
      data: {
        order_id: order.id,
        display_id: input.display_id,
      },
    });
    logger.info(
      `[order-canceled-email] sent cancellation for order ${input.display_id} to ${email}`,
    );
  } catch (err) {
    logger.error(
      `[order-canceled-email] failed to send for order ${data.id} to ${email}: ${(err as Error).message}`,
    );
  }
}

export const config: SubscriberConfig = {
  event: "order.canceled",
};
