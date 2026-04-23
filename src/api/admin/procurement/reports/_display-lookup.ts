/**
 * Shared helper for reports: build a map from inventory_item_id to
 * the display info of the OWNING variant.
 *
 * Owner definition: the variant whose SKU matches the
 * `inventory_item.sku`. Medusa seeds the inventory_item with the
 * same SKU as its primary variant, so this is a reliable signal.
 *
 * Needed because in Medusa v2 inventory kits, a single-component
 * bundle variant has exactly one `inventory_items[0]` — the same
 * one that its component variant directly owns. So you can't
 * distinguish owner vs. bundle by `inventory_items.length`. An SKU
 * match is the authoritative disambiguator.
 */

import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

export type VariantDisplay = {
  sku: string | null;
  product_title: string | null;
  variant_title: string | null;
};

export async function loadVariantDisplayByInventoryItem(
  container: MedusaContainer,
): Promise<Map<string, VariantDisplay>> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);

  // Fetch inventory items first so we know the expected sku for each
  // inventory_item id. Then only map a variant if its sku matches.
  const { data: invItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku"],
    filters: {} as never,
  });
  const skuByInvId = new Map<string, string>();
  for (const ii of invItems as Array<{ id: string; sku: string | null }>) {
    if (ii.sku) skuByInvId.set(ii.id, ii.sku);
  }

  const { data: variants } = await query.graph({
    entity: "product_variant",
    fields: [
      "id",
      "sku",
      "title",
      "product.title",
      "inventory_items.inventory.id",
    ],
    filters: {} as never,
  });

  const map = new Map<string, VariantDisplay>();
  for (const v of variants as Array<{
    id: string;
    sku: string | null;
    title: string;
    product?: { title?: string };
    inventory_items?: Array<{ inventory?: { id: string } }>;
  }>) {
    if (!v.sku) continue;
    for (const link of v.inventory_items ?? []) {
      const invId = link.inventory?.id;
      if (!invId) continue;
      // Only claim ownership if this variant's SKU matches the
      // inventory_item's SKU — that filters out bundle links.
      if (skuByInvId.get(invId) !== v.sku) continue;
      map.set(invId, {
        sku: v.sku,
        product_title: v.product?.title ?? null,
        variant_title: v.title,
      });
    }
  }
  return map;
}
