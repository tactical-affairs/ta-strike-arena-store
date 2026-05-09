/**
 * Back-in-stock email dispatcher.
 *
 * When inventory levels change, look up any pending back-in-stock
 * subscriptions for the affected variant. If the variant currently has
 * stock available (manage_inventory false, allow_backorder true, or
 * inventory_quantity > 0), email each subscriber and mark them
 * notified.
 *
 * Idempotency: each subscription has its notified_at flipped to a
 * timestamp the moment we send. Subsequent inventory events for the
 * same variant skip already-notified rows.
 *
 * Events:
 *   inventory-level.created/updated  — admin restock or initial level
 *   reservation-item.deleted         — order cancel releases stock
 *
 * The subscriber resolves event.data.id to a list of affected
 * variants, queries pending subscriptions, and sends.
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils";
import { BACK_IN_STOCK_MODULE } from "../modules/back-in-stock";
import type BackInStockModuleService from "../modules/back-in-stock/service";

type VariantInventory = {
  id: string;
  manage_inventory: boolean;
  allow_backorder: boolean;
  // Computed at the call site by summing available qty across all
  // inventory items + locations linked to this variant. Not fetched via
  // the graph because the field doesn't materialize through inventory_item
  // -> variants traversals.
  inventory_quantity: number;
  product?: { handle?: string; title?: string; thumbnail?: string | null };
};

async function variantsForInventoryItem(
  container: SubscriberArgs<{ id: string }>["container"],
  inventoryItemId: string,
): Promise<VariantInventory[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const inventoryService = container.resolve(Modules.INVENTORY);

  // Step 1 — walk inventory_item -> link -> variants to find affected variants.
  const { data: items } = await query.graph({
    entity: "inventory_item",
    fields: [
      "id",
      "variants.id",
      "variants.manage_inventory",
      "variants.allow_backorder",
      "variants.product.handle",
      "variants.product.title",
      "variants.product.thumbnail",
      "variants.inventory_items.inventory.id",
      "variants.inventory_items.inventory.location_levels.location_id",
    ],
    filters: { id: [inventoryItemId] },
  });
  const variants = (items as Array<{
    variants?: Array<
      Omit<VariantInventory, "inventory_quantity"> & {
        inventory_items?: Array<{
          inventory?: {
            id: string;
            location_levels?: Array<{ location_id: string }>;
          };
        }>;
      }
    >;
  }>)[0]?.variants ?? [];

  // Step 2 — for each variant, compute inventory_quantity by summing
  // available stock across every linked inventory item + location.
  // `retrieveAvailableQuantity` is the canonical inventory API for this.
  const out: VariantInventory[] = [];
  for (const v of variants) {
    let total = 0;
    for (const link of v.inventory_items ?? []) {
      const inv = link.inventory;
      if (!inv) continue;
      const locationIds = (inv.location_levels ?? []).map(
        (l) => l.location_id,
      );
      if (locationIds.length === 0) continue;
      const qty = await inventoryService.retrieveAvailableQuantity(
        inv.id,
        locationIds,
      );
      // retrieveAvailableQuantity returns IBigNumber; coerce via Number().
      total += Number(qty ?? 0);
    }
    out.push({
      id: v.id,
      manage_inventory: v.manage_inventory,
      allow_backorder: v.allow_backorder,
      inventory_quantity: total,
      product: v.product,
    });
  }
  return out;
}

async function variantsForReservationItem(
  container: SubscriberArgs<{ id: string }>["container"],
  reservationItemId: string,
): Promise<VariantInventory[]> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "reservation",
    fields: ["id", "inventory_item_id"],
    filters: { id: [reservationItemId] },
  });
  const itemId = (data as Array<{ inventory_item_id?: string }>)[0]
    ?.inventory_item_id;
  if (!itemId) return [];
  return variantsForInventoryItem(container, itemId);
}

function isAvailable(v: VariantInventory): boolean {
  if (!v.manage_inventory) return true;
  if (v.allow_backorder) return true;
  return (v.inventory_quantity ?? 0) > 0;
}

function buildEmail(productName: string, productHandle: string | undefined): {
  subject: string;
  html: string;
  text: string;
} {
  const url = productHandle
    ? `https://strikearena.net/shop/${productHandle}/`
    : "https://strikearena.net/shop/";
  const subject = `Back in stock: ${productName}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="font-size: 22px; margin: 0 0 12px;">Good news — it's back in stock.</h2>
      <p style="font-size: 16px; line-height: 1.5;">
        <strong>${escapeHtml(productName)}</strong> is available again at
        Strike Arena. Quantities are limited, so grab one while you can.
      </p>
      <p style="margin: 24px 0;">
        <a href="${url}" style="background: #FF6A00; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 6px; display: inline-block; font-weight: 600;">
          Buy now
        </a>
      </p>
      <p style="font-size: 14px; color: #666;">
        Or visit <a href="${url}" style="color: #FF6A00;">${url}</a>.
      </p>
      <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
      <p style="font-size: 12px; color: #999;">
        You're receiving this because you signed up for back-in-stock
        notifications on strikearena.net. We won't email you again about
        this product unless you re-subscribe.
      </p>
    </div>
  `;
  const text = `Good news — ${productName} is back in stock at Strike Arena.\n\nBuy now: ${url}\n\nYou're receiving this because you signed up for back-in-stock notifications on strikearena.net.`;
  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export default async function inventoryRestockNotifyHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const triggerId = event.data?.id;
  if (!triggerId) return;

  let variants: VariantInventory[] = [];
  try {
    if (event.name?.startsWith("inventory-level.")) {
      // event.data.id is an inventory_level id; resolve to inventory_item_id
      const query = container.resolve(ContainerRegistrationKeys.QUERY);
      const { data } = await query.graph({
        entity: "inventory_level",
        fields: ["id", "inventory_item_id"],
        filters: { id: [triggerId] },
      });
      const itemId = (data as Array<{ inventory_item_id?: string }>)[0]
        ?.inventory_item_id;
      if (itemId) variants = await variantsForInventoryItem(container, itemId);
    } else if (event.name?.startsWith("inventory-item.")) {
      variants = await variantsForInventoryItem(container, triggerId);
    } else if (event.name?.startsWith("reservation-item.")) {
      variants = await variantsForReservationItem(container, triggerId);
    }
  } catch (err) {
    logger.warn(
      `[restock-notify] could not resolve ${event.name} ${triggerId}: ${(err as Error).message}`,
    );
    return;
  }

  if (variants.length === 0) return;

  const service = container.resolve(
    BACK_IN_STOCK_MODULE,
  ) as BackInStockModuleService;
  const notificationModule = container.resolve(Modules.NOTIFICATION);

  for (const variant of variants) {
    if (!isAvailable(variant)) continue;
    const pending = await service.listPendingForVariant(variant.id);
    if (pending.length === 0) continue;

    const productName = variant.product?.title ?? "Your wishlist item";
    const productHandle = variant.product?.handle;
    const email = buildEmail(productName, productHandle);
    const sentIds: string[] = [];

    for (const sub of pending) {
      try {
        await notificationModule.createNotifications({
          to: sub.email,
          channel: "email",
          template: "back-in-stock",
          idempotency_key: `back-in-stock:${sub.id}`,
          content: {
            subject: email.subject,
            html: email.html,
            text: email.text,
          },
          data: {
            subscription_id: sub.id,
            variant_id: variant.id,
            product_handle: productHandle,
            replyTo: "support@strikearena.net",
          },
        });
        sentIds.push(sub.id);
      } catch (err) {
        logger.error(
          `[restock-notify] send failed for ${sub.email} (sub ${sub.id}): ${(err as Error).message}`,
        );
      }
    }

    if (sentIds.length > 0) {
      await service.markNotified(sentIds);
      logger.info(
        `[restock-notify] sent ${sentIds.length} email(s) for variant ${variant.id} (${productName})`,
      );
    }
  }
}

export const config: SubscriberConfig = {
  event: [
    "inventory-level.created",
    "inventory-level.updated",
    "inventory-item.updated",
    "reservation-item.deleted",
  ],
};
