import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExecArgs } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { updateProductsWorkflow } from "@medusajs/medusa/core-flows";

/**
 * One-off: re-upload product photos that had background-removal remnants
 * (small green/gray fragments in the upper-left corner of the gun cutout)
 * cleaned in `ta-strike-arena-website/public/images/la-*`. Reads the now-
 * cleaned PNGs, uploads via Medusa's File Module, and swaps the matching
 * old URL on each product with the freshly-uploaded URL.
 *
 * Match rule: the seed flattens `la-2011-mk/main.png` into
 * `la-2011-mk__main.png` before upload, and the S3 provider prefixes a
 * UUID, so each existing URL contains the flattened name as a substring.
 *
 * Local: `npx medusa exec ./src/scripts/reupload-cleaned-product-images.ts`
 * Prod : `railway run --service medusa -- env DATABASE_URL="<public-url>?sslmode=no-verify" \
 *           npx medusa exec ./src/scripts/reupload-cleaned-product-images.ts`
 *
 * Idempotent: re-running uploads new copies and re-points each product's
 * images at the latest copy. Old R2 objects are NOT pruned (cheap; Cloudflare
 * R2 has no per-object cost) — write a sweep later if it matters.
 */

const MARKETING_IMAGES_DIR = path.resolve(
  process.cwd(),
  "../ta-strike-arena-website/public/images",
);

type Replacement = {
  handle: string;
  /** Paths under `public/images/`, e.g. `la-2011-mk/main.png`. */
  paths: string[];
};

const REPLACEMENTS: Replacement[] = [
  {
    handle: "laser-ammo-recoil-enabled-training-pistol-aw-custom-2011",
    paths: ["la-2011-mk/main.png", "la-2011-mk/detail.png"],
  },
  {
    handle: "laser-ammo-recoil-enabled-training-pistol-cz-shadow-2",
    paths: ["la-cz-shadow-2/main.png"],
  },
  {
    handle: "laser-ammo-recoil-enabled-glock-17-gen-5-training-pistol-green-gas",
    paths: ["la-glock-17/detail.png"],
  },
  {
    handle: "laser-ammo-recoil-enabled-glock-19-gen-5-training-pistol-green-gas-copy",
    paths: ["la-glock-19/side.png"],
  },
  {
    handle: "laser-ammo-recoil-enabled-glock-45-training-pistol-green-gas",
    paths: ["la-glock-45/main.png", "la-glock-45/angle.png"],
  },
  {
    handle: "laser-ammo-recoil-enabled-training-pistol-sig-p320-m17-green-gas",
    paths: ["la-sig-m17/side.png"],
  },
];

const flatten = (rel: string) => rel.replace(/[\/\\]/g, "__");

export default async function reuploadCleanedProductImages({
  container,
}: ExecArgs) {
  const fileModuleService = container.resolve(Modules.FILE);
  const productService = container.resolve(Modules.PRODUCT);

  for (const { handle, paths } of REPLACEMENTS) {
    const [product] = await productService.listProducts(
      { handle },
      { take: 1, relations: ["images"] },
    );
    if (!product) {
      console.log(`[reupload] SKIP ${handle} — product not found`);
      continue;
    }

    const currentImages = (product.images ?? []) as Array<{
      id: string;
      url: string;
    }>;
    const urls = currentImages.map((i) => i.url);

    let mutated = false;
    for (const relPath of paths) {
      const flat = flatten(relPath);
      const matchIdx = urls.findIndex((u) => u.includes(flat));
      if (matchIdx < 0) {
        console.log(
          `[reupload] WARN ${handle}: no existing image url contains "${flat}" — appending instead`,
        );
      }

      const fullPath = path.join(MARKETING_IMAGES_DIR, relPath);
      const buffer = await fs.readFile(fullPath);
      const result = await fileModuleService.createFiles({
        filename: flat,
        mimeType: "image/png",
        content: buffer.toString("base64"),
        access: "public",
      });

      if (matchIdx >= 0) {
        urls[matchIdx] = result.url;
      } else {
        urls.push(result.url);
      }
      mutated = true;
      console.log(`[reupload] OK   ${handle} ${relPath} -> ${result.url}`);
    }

    if (mutated) {
      await updateProductsWorkflow(container).run({
        input: {
          products: [
            { id: product.id, images: urls.map((url) => ({ url })) },
          ],
        },
      });
    }
  }

  console.log("[reupload] done");
}
