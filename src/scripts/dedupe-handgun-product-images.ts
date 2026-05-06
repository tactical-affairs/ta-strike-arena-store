import type { ExecArgs } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows";

/**
 * Cleanup for the over-eager append in reupload-cleaned-product-images.ts.
 *
 * That script's substring match (`la-2011-mk__main.png`) didn't account
 * for the file storage's `-<ULID>.png` suffix on existing URLs, so each
 * cleaned upload was *appended* instead of replacing the dirty original.
 * Affected products now have both a dirty pre-cleanup URL and a clean
 * post-cleanup URL for the same logical image.
 *
 * Rule: group images by stem (filename minus the trailing
 * `-<26-char-ULID>.<ext>`), keep the URL with the largest ULID per
 * stem (ULIDs sort lexicographically by time → newest is the cleaned
 * one), and preserve original order by first-occurrence position.
 *
 * Idempotent: running again is a no-op once each stem has exactly one
 * URL.
 */

const HANDLES = [
  "laser-ammo-recoil-enabled-training-pistol-aw-custom-2011",
  "laser-ammo-recoil-enabled-training-pistol-cz-shadow-2",
  "laser-ammo-recoil-enabled-glock-17-gen-5-training-pistol-green-gas",
  "laser-ammo-recoil-enabled-glock-19-gen-5-training-pistol-green-gas-copy",
  "laser-ammo-recoil-enabled-glock-45-training-pistol-green-gas",
  "laser-ammo-recoil-enabled-training-pistol-sig-p320-m17-green-gas",
];

const ULID_SUFFIX = /-[0-9A-Z]{26}(\.[A-Za-z0-9]+)?$/;

function stemOf(url: string): string {
  const filename = url.split("/").pop() ?? url;
  const noExt = filename.replace(/\.[^.]+$/, "");
  return noExt.replace(/-[0-9A-Z]{26}$/, "");
}

export default async function dedupeHandgunProductImages({
  container,
}: ExecArgs) {
  const productService = container.resolve(Modules.PRODUCT);

  for (const handle of HANDLES) {
    const [product] = await productService.listProducts(
      { handle },
      { take: 1, relations: ["images"] },
    );
    if (!product) {
      console.log(`[dedupe] SKIP ${handle} — not found`);
      continue;
    }

    const images = (product.images ?? []) as Array<{ url: string }>;
    const urls = images.map((i) => i.url);

    // Best (newest) URL per stem. ULIDs sort lexicographically.
    const bestPerStem = new Map<string, string>();
    for (const url of urls) {
      const stem = stemOf(url);
      const cur = bestPerStem.get(stem);
      if (!cur || url > cur) bestPerStem.set(stem, url);
    }

    // Preserve original order via first-occurrence.
    const seen = new Set<string>();
    const finalUrls: string[] = [];
    for (const url of urls) {
      const stem = stemOf(url);
      if (seen.has(stem)) continue;
      seen.add(stem);
      finalUrls.push(bestPerStem.get(stem)!);
    }

    if (finalUrls.length === urls.length) {
      console.log(`[dedupe] SKIP ${handle} (no duplicates)`);
      continue;
    }

    await updateProductsWorkflow(container).run({
      input: {
        products: [
          { id: product.id, images: finalUrls.map((url) => ({ url })) },
        ],
      },
    });
    console.log(
      `[dedupe] OK   ${handle}: ${urls.length} → ${finalUrls.length}`,
    );
    for (const u of finalUrls) console.log(`           ${u}`);
  }

  console.log("[dedupe] done");
}
