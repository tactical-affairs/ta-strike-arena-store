import type { ExecArgs } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

/**
 * Surface the Starter + Premium Recoil Training Handgun *collections* as
 * "you may also like" tiles on every target / target-package product page,
 * and ensure every gun-collection cross-sell tile has a kit-collage image
 * (the same ones /pricing/ uses for kit cards).
 *
 * Two writes:
 *   1. Set `metadata.related_collection_handles = [starter, premium]` on
 *      each target/package product so the storefront's shop page renders
 *      them as cross-sell tiles alongside any existing related products.
 *   2. Set `metadata.image_url` on every collection in COLLECTION_IMAGES
 *      so its tile renders with the kit-collage instead of falling back to
 *      a member product's thumbnail.
 *
 * Idempotent — re-running produces the same state.
 *
 * Local: `npx medusa exec ./src/scripts/add-handgun-collection-cross-sells.ts`
 * Prod : `railway run --service medusa -- env DATABASE_URL="<public-url>?sslmode=no-verify" npx medusa exec ./src/scripts/add-handgun-collection-cross-sells.ts`
 */

const TARGET_PRODUCTS = [
  "strike-arena-pro-target",
  "strike-arena-pro-premium-package",
  "strike-arena-home-target",
  "strike-arena-home-starter-package",
  "strike-arena-home-plus-package",
];

const HANDGUN_CROSS_SELL_COLLECTIONS = [
  "starter-recoil-training-handgun",
  "premium-recoil-training-handgun",
];

const COLLECTION_IMAGES: Record<string, string> = {
  "starter-recoil-training-handgun":
    "/images/shop/starter-handgun-collection.png",
  "premium-recoil-training-handgun":
    "/images/shop/premium-handgun-collection.png",
  "starter-recoil-training-rifle":
    "/images/shop/starter-rifle-collection.png",
};

export default async function addHandgunCollectionCrossSells({
  container,
}: ExecArgs) {
  const productService = container.resolve(Modules.PRODUCT);

  // 1. Patch target/package products with cross-sell collection handles.
  for (const handle of TARGET_PRODUCTS) {
    const [product] = await productService.listProducts(
      { handle },
      { take: 1 },
    );
    if (!product) {
      console.log(`[cross-sell] SKIP product ${handle} — not found.`);
      continue;
    }
    const existing = (product.metadata ?? {}) as Record<string, unknown>;
    await productService.updateProducts(product.id, {
      metadata: {
        ...existing,
        related_collection_handles: HANDGUN_CROSS_SELL_COLLECTIONS,
      },
    });
    console.log(`[cross-sell] OK   product ${handle}`);
  }

  // 2. Patch every collection in COLLECTION_IMAGES with its kit-collage image.
  for (const handle of Object.keys(COLLECTION_IMAGES)) {
    const [collection] = await productService.listProductCollections(
      { handle },
      { take: 1 },
    );
    if (!collection) {
      console.log(`[cross-sell] SKIP collection ${handle} — not found.`);
      continue;
    }
    const existing = (collection.metadata ?? {}) as Record<string, unknown>;
    await productService.updateProductCollections(collection.id, {
      metadata: { ...existing, image_url: COLLECTION_IMAGES[handle] },
    });
    console.log(`[cross-sell] OK   collection ${handle}`);
  }
}
