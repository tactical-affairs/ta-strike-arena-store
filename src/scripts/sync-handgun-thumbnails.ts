import type { ExecArgs } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows";

/**
 * The reupload + dedupe pipeline only touched `images[]`. Medusa products
 * carry an independent `thumbnail` field — the collection landing tiles
 * and other listing surfaces read `thumbnail` first, falling back to
 * `images[0]` only if it's missing. After the cleanup, three products'
 * thumbnails still pointed at the dirty pre-cleanup URLs.
 *
 * Rule: if `thumbnail` doesn't appear anywhere in the current `images`
 * URL list, replace it with the URL whose stem matches it best (same
 * filename minus the ULID), preferring the largest ULID. Idempotent.
 */

const HANDLES = [
  "laser-ammo-recoil-enabled-training-pistol-aw-custom-2011",
  "laser-ammo-recoil-enabled-training-pistol-cz-shadow-2",
  "laser-ammo-recoil-enabled-glock-17-gen-5-training-pistol-green-gas",
  "laser-ammo-recoil-enabled-glock-19-gen-5-training-pistol-green-gas-copy",
  "laser-ammo-recoil-enabled-glock-45-training-pistol-green-gas",
  "laser-ammo-recoil-enabled-training-pistol-sig-p320-m17-green-gas",
];

function stemOf(url: string): string {
  const filename = url.split("/").pop() ?? url;
  const noExt = filename.replace(/\.[^.]+$/, "");
  return noExt.replace(/-[0-9A-Z]{26}$/, "");
}

export default async function syncHandgunThumbnails({
  container,
}: ExecArgs) {
  const productService = container.resolve(Modules.PRODUCT);

  for (const handle of HANDLES) {
    const [product] = await productService.listProducts(
      { handle },
      { take: 1, relations: ["images"] },
    );
    if (!product) {
      console.log(`[thumbsync] SKIP ${handle} — not found`);
      continue;
    }

    const thumb = product.thumbnail ?? null;
    const imageUrls = ((product.images ?? []) as Array<{ url: string }>).map(
      (i) => i.url,
    );

    if (!thumb) {
      console.log(`[thumbsync] SKIP ${handle} — no thumbnail set`);
      continue;
    }
    if (imageUrls.includes(thumb)) {
      console.log(`[thumbsync] SKIP ${handle} — thumbnail already in images`);
      continue;
    }

    const targetStem = stemOf(thumb);
    const candidates = imageUrls.filter((u) => stemOf(u) === targetStem);
    if (candidates.length === 0) {
      console.log(
        `[thumbsync] WARN ${handle}: no image with stem "${targetStem}" — skipping`,
      );
      continue;
    }
    candidates.sort();
    const newThumb = candidates[candidates.length - 1];

    await updateProductsWorkflow(container).run({
      input: { products: [{ id: product.id, thumbnail: newThumb }] },
    });
    console.log(
      `[thumbsync] OK   ${handle}\n             from ${thumb}\n             to   ${newThumb}`,
    );
  }

  console.log("[thumbsync] done");
}
