import type { ExecArgs } from "@medusajs/framework/types";

/**
 * One-off: force a path-level revalidation of the affected handgun pages.
 *
 * `revalidateTag` only clears the Data Cache. Pages prerendered at build
 * time (anything in `generateStaticParams`) keep their HTML in the Full
 * Route Cache until a path-level revalidate fires. After the thumbnail
 * sync, the underlying data is correct but the static collection page
 * HTML is still serving stale URLs.
 *
 * The website-revalidate subscriber has been updated to send the
 * collection path going forward, but we also need to bust the cache once
 * for the changes that already shipped.
 *
 * Reads WEBSITE_REVALIDATE_URL + REVALIDATE_SECRET from the medusa
 * service env, so this must be invoked through `railway run --service
 * medusa --` (which is the standard pattern for any prod-touching script).
 */

const PATHS = [
  "/shop/collections/premium-recoil-training-handgun",
  "/shop/laser-ammo-recoil-enabled-training-pistol-aw-custom-2011",
  "/shop/laser-ammo-recoil-enabled-training-pistol-cz-shadow-2",
  "/shop/laser-ammo-recoil-enabled-glock-17-gen-5-training-pistol-green-gas",
  "/shop/laser-ammo-recoil-enabled-glock-19-gen-5-training-pistol-green-gas-copy",
  "/shop/laser-ammo-recoil-enabled-glock-45-training-pistol-green-gas",
  "/shop/laser-ammo-recoil-enabled-training-pistol-sig-p320-m17-green-gas",
];

const TAGS = ["products:list", "pricing"];

export default async function forceRevalidate(_args: ExecArgs) {
  const url = process.env.WEBSITE_REVALIDATE_URL;
  const secret = process.env.REVALIDATE_SECRET;
  if (!url || !secret) {
    throw new Error("WEBSITE_REVALIDATE_URL or REVALIDATE_SECRET not set");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-revalidate-secret": secret,
    },
    body: JSON.stringify({ tags: TAGS, paths: PATHS }),
  });

  console.log(`[force-revalidate] ${res.status}: ${await res.text()}`);
  console.log(`  tags : ${TAGS.join(", ")}`);
  console.log(`  paths: ${PATHS.length}`);
}
