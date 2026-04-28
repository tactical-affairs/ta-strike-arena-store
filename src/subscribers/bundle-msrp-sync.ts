/**
 * Keeps each bundle's `metadata.msrp_amount` in sync with the running cost
 * of its components. Whenever a non-bundle product is updated, this finds
 * every bundle whose Inventory Kit references one of that product's
 * inventory_items and recomputes:
 *
 *     msrp_amount = Σ component.calculated_price.calculated_amount × required_quantity
 *
 * The bundle's *sell price* (the regular price field) is left alone — that's
 * a marketing decision, not arithmetic. Only the "compare-at" MSRP tracks
 * component reality, so the storefront's "save $X (Y%)" line stays accurate.
 *
 * Loop guard: when we patch a bundle's metadata, that itself fires
 * `product.updated`. The early-return on `metadata.is_bundle` skips re-entry
 * cleanly, since bundles' MSRPs are computed from non-bundles only.
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { updateProductVariantsWorkflow } from "@medusajs/medusa/core-flows";

type Variant = {
  id: string;
  sku: string | null;
  metadata: Record<string, unknown> | null;
  prices?: Array<{ amount: number; currency_code: string }> | null;
  inventory_items?: Array<{
    inventory_item_id: string;
    required_quantity: number | null;
  }> | null;
  product?: {
    id: string;
    handle: string;
    metadata: Record<string, unknown> | null;
  } | null;
};

const CURRENCY = "usd";

function usdPrice(v: Variant): number | null {
  const p = (v.prices ?? []).find((x) => x.currency_code === CURRENCY);
  return p?.amount ?? null;
}

export default async function bundleMsrpSync({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  const triggerId = event.data?.id;
  if (!triggerId) return;

  // 1. Resolve which inventory_item_ids changed. The trigger can be either a
  //    product (`product.updated`) or a single variant (`product-variant.*`).
  //    Either way, we need the variant.inventory_items the trigger touched.
  //    If the trigger is itself a bundle, bail out — we only react to
  //    non-bundle (component) price changes. This is also the loop guard
  //    for when our own write below triggers product-variant.updated.
  const isVariantEvent = event.name?.startsWith("product-variant.");
  let triggerVariants: Array<{
    inventory_items: Array<{ inventory_item_id: string }> | null;
  }> = [];

  if (isVariantEvent) {
    const { data: variants } = await query.graph({
      entity: "variant",
      fields: [
        "id",
        "product.metadata",
        "inventory_items.inventory_item_id",
      ],
    });
    const v = (variants as Array<{
      id: string;
      product: { metadata: Record<string, unknown> | null } | null;
      inventory_items: Array<{ inventory_item_id: string }> | null;
    }> | undefined ?? []).find((x) => x.id === triggerId);
    if (!v) return;
    if ((v.product?.metadata as { is_bundle?: boolean } | null)?.is_bundle) return;
    triggerVariants = [{ inventory_items: v.inventory_items }];
  } else {
    const { data: updatedProducts } = await query.graph({
      entity: "product",
      fields: [
        "id",
        "metadata",
        "variants.id",
        "variants.inventory_items.inventory_item_id",
      ],
      filters: { id: [triggerId] },
    });
    const updatedProduct = (updatedProducts as Array<{
      id: string;
      metadata: Record<string, unknown> | null;
      variants: Array<{
        id: string;
        inventory_items: Array<{ inventory_item_id: string }> | null;
      }> | null;
    }> | undefined)?.[0];
    if (!updatedProduct) return;
    if ((updatedProduct.metadata as { is_bundle?: boolean } | null)?.is_bundle) return;
    triggerVariants = updatedProduct.variants ?? [];
  }

  // 2. Collect the trigger's component inventory_item_ids.
  const componentItemIds = new Set<string>();
  for (const v of triggerVariants) {
    for (const ii of v.inventory_items ?? []) {
      if (ii.inventory_item_id) componentItemIds.add(ii.inventory_item_id);
    }
  }
  if (componentItemIds.size === 0) return;

  // 3. Find bundle variants whose Inventory Kits reference any of those
  //    inventory_items. The catalog is small (~22 products), so over-fetch
  //    every variant and filter in-memory rather than wrestling with
  //    nested filters on query.graph (which doesn't expose the
  //    inventory_items.inventory_item_id filter path in its types).
  const { data: allVariants } = await query.graph({
    entity: "variant",
    fields: [
      "id",
      "sku",
      "metadata",
      "product.id",
      "product.handle",
      "product.metadata",
      "inventory_items.inventory_item_id",
      "inventory_items.required_quantity",
    ],
  });

  const bundleVariants = (allVariants as Variant[] | undefined ?? []).filter(
    (v) =>
      (v.product?.metadata as { is_bundle?: boolean } | null)?.is_bundle ===
        true &&
      (v.inventory_items ?? []).some((ii) =>
        componentItemIds.has(ii.inventory_item_id),
      ),
  );
  if (bundleVariants.length === 0) return;

  // 4. For each affected bundle, fetch all of its component prices in one
  //    query, sum them, and patch the bundle variant's metadata.msrp_amount.
  for (const bundle of bundleVariants) {
    const allComponentIds = (bundle.inventory_items ?? [])
      .map((ii) => ii.inventory_item_id)
      .filter(Boolean);
    if (allComponentIds.length === 0) continue;

    const { data: componentVariants } = await query.graph({
      entity: "variant",
      fields: [
        "id",
        "sku",
        "prices.amount",
        "prices.currency_code",
        "inventory_items.inventory_item_id",
        "product.metadata",
      ],
    });

    // Build inventory_item_id → unit price lookup.
    //
    // CRITICAL filter: skip variants whose product is itself a bundle. Both
    // bundles and non-bundles list inventory_items[] (bundles list their
    // components; non-bundles list their own single inventory_item), but a
    // bundle's prices[].amount is the bundle sell price, not a component
    // price. Without this filter, the math sums in the bundle's price and
    // produces nonsense (e.g. 5× $495 instead of 5× $125).
    //
    // We read prices[] directly rather than calculated_price because the
    // latter needs a region/currency context not available in admin-side
    // query.graph.
    const wantedIds = new Set(allComponentIds);
    const priceByItemId = new Map<string, number>();
    for (const cv of (componentVariants as Variant[] | undefined) ?? []) {
      if ((cv.product?.metadata as { is_bundle?: boolean } | null)?.is_bundle) {
        continue;
      }
      const itemId = cv.inventory_items?.[0]?.inventory_item_id;
      const price = usdPrice(cv);
      if (itemId && wantedIds.has(itemId) && price != null) {
        priceByItemId.set(itemId, price);
      }
    }

    let newMsrp = 0;
    let missingComponents = 0;
    for (const ii of bundle.inventory_items ?? []) {
      const price = priceByItemId.get(ii.inventory_item_id);
      const qty = ii.required_quantity ?? 1;
      if (price == null) {
        missingComponents++;
        continue;
      }
      newMsrp += price * qty;
    }

    if (missingComponents > 0) {
      logger.warn(
        `[bundle-msrp] ${bundle.sku ?? bundle.id} has ${missingComponents} component(s) without a price — leaving MSRP unchanged`,
      );
      continue;
    }

    const currentMsrp = (bundle.metadata as { msrp_amount?: number } | null)
      ?.msrp_amount;
    if (currentMsrp === newMsrp) {
      // No change → no write → no event → no loop.
      continue;
    }

    try {
      // Use the canonical workflow rather than poking the module directly —
      // the workflow runs through the same path the admin API uses, fires
      // hooks, and (most importantly here) actually persists the change.
      // Direct ProductModule.updateProductVariants() returned an empty array
      // and silently dropped writes when called from a subscriber.
      await updateProductVariantsWorkflow(container).run({
        input: {
          product_variants: [
            {
              id: bundle.id,
              metadata: {
                ...(bundle.metadata ?? {}),
                msrp_amount: newMsrp,
              },
            },
          ],
        },
      });
      logger.info(
        `[bundle-msrp] ${bundle.sku ?? bundle.id}: msrp ${currentMsrp ?? "—"} → ${newMsrp} (triggered by ${triggerId})`,
      );
    } catch (err) {
      logger.error(
        `[bundle-msrp] ${bundle.sku ?? bundle.id}: update FAILED: ${(err as Error).message}`,
      );
    }
  }
}

export const config: SubscriberConfig = {
  event: ["product.updated", "product-variant.updated"],
};
