import type { ExecArgs } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";

/**
 * Post-lineup-change metadata cleanup. Idempotent.
 *
 * 1. strike-arena-pro-premium-package — refresh `features` to absorb the
 *    commercial-grade benefits (Pro Premium replaced the old Bay package),
 *    and drop dangling `strike-arena-pro-plus-package` from related_handles.
 * 2. strike-arena-pro-target — drop dangling `strike-arena-pro-plus-package`
 *    from related_handles.
 * 3. strike-arena-training-console — drop dangling
 *    `strike-arena-pro-plus-package` from related_handles.
 * 4. strike-arena-home-starter-package — replace the renamed handle
 *    `strike-arena-home-premium-package` with the new
 *    `strike-arena-home-plus-package` in related_handles.
 *
 * Local: `npx medusa exec ./src/scripts/cleanup-product-lineup.ts`
 * Prod : `railway run --service medusa -- env DATABASE_URL="<public-url>?sslmode=no-verify" npx medusa exec ./src/scripts/cleanup-product-lineup.ts`
 */

type Patch = {
  handle: string;
  features?: string[];
  relatedHandles?: { drop?: string[]; replace?: Record<string, string> };
};

const PATCHES: Patch[] = [
  {
    handle: "strike-arena-pro-premium-package",
    features: [
      "1 training console",
      "10 wireless reactive Pro targets",
      "Multi-color LED, rechargeable battery",
      "Browser-based control",
      "Large bay setup",
      "Unlocks advanced drills",
      "Dedicated account manager",
      "Priority support & onboarding",
    ],
    relatedHandles: { drop: ["strike-arena-pro-plus-package"] },
  },
  {
    handle: "strike-arena-pro-target",
    relatedHandles: { drop: ["strike-arena-pro-plus-package"] },
  },
  {
    handle: "strike-arena-training-console",
    relatedHandles: { drop: ["strike-arena-pro-plus-package"] },
  },
  {
    handle: "strike-arena-home-starter-package",
    relatedHandles: {
      replace: {
        "strike-arena-home-premium-package": "strike-arena-home-plus-package",
      },
    },
  },
];

export default async function cleanupProductLineup({ container }: ExecArgs) {
  const productService = container.resolve(Modules.PRODUCT);

  for (const patch of PATCHES) {
    const [product] = await productService.listProducts(
      { handle: patch.handle },
      { take: 1 },
    );
    if (!product) {
      console.log(`[cleanup] SKIP ${patch.handle} — not found.`);
      continue;
    }

    const existing = (product.metadata ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...existing };

    if (patch.features) {
      next.features = patch.features;
    }

    if (patch.relatedHandles && Array.isArray(existing.related_handles)) {
      const drop = new Set(patch.relatedHandles.drop ?? []);
      const replace = patch.relatedHandles.replace ?? {};
      next.related_handles = (existing.related_handles as string[])
        .map((h) => replace[h] ?? h)
        .filter((h) => !drop.has(h));
    }

    await productService.updateProducts(product.id, { metadata: next });
    console.log(`[cleanup] OK   ${patch.handle}`);
  }
}
