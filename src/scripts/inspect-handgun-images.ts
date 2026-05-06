import type { ExecArgs } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

const HANDLES = [
  "laser-ammo-recoil-enabled-training-pistol-aw-custom-2011",
  "laser-ammo-recoil-enabled-training-pistol-cz-shadow-2",
  "laser-ammo-recoil-enabled-glock-17-gen-5-training-pistol-green-gas",
  "laser-ammo-recoil-enabled-glock-19-gen-5-training-pistol-green-gas-copy",
  "laser-ammo-recoil-enabled-glock-45-training-pistol-green-gas",
  "laser-ammo-recoil-enabled-training-pistol-sig-p320-m17-green-gas",
];

export default async function inspectHandgunImages({ container }: ExecArgs) {
  const productService = container.resolve(Modules.PRODUCT);
  for (const handle of HANDLES) {
    const [product] = await productService.listProducts(
      { handle },
      { take: 1, relations: ["images"] },
    );
    if (!product) {
      console.log(`# ${handle} — NOT FOUND`);
      continue;
    }
    const images = (product.images ?? []) as Array<{ url: string }>;
    console.log(`# ${handle} (${images.length} images)`);
    for (const img of images) {
      console.log(`  ${img.url}`);
    }
  }
}
