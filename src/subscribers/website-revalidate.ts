/**
 * Posts cache-busts to the website's /api/revalidate when product or
 * collection data changes in Medusa, so storefront pages reflect edits
 * within seconds instead of waiting for the 5-minute ISR window.
 *
 * Tags are matched to what src/lib/medusa-products.ts on the website sets
 * via `next: { tags }`:
 *   - "products:list"             — invalidates list/collection pages
 *   - "pricing"                   — invalidates pricing/catalog
 *   - "product:<handle>"          — single product page
 *   - "collection:<handle>"       — single collection page
 *   - "collections:list"          — collections listing
 *
 * Required env vars on the Medusa service:
 *   WEBSITE_REVALIDATE_URL   e.g. https://strikearena.net/api/revalidate
 *   REVALIDATE_SECRET        same value as on the website service
 *
 * If either is unset we no-op (still useful in dev/local where there's
 * no website to ping).
 */

import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";

const WEBSITE_URL = process.env.WEBSITE_REVALIDATE_URL;
const SECRET = process.env.REVALIDATE_SECRET;

async function postRevalidate(
  logger: { info: (m: string) => void; warn: (m: string) => void; error: (m: string) => void },
  body: { tags?: string[]; paths?: string[] },
) {
  if (!WEBSITE_URL || !SECRET) {
    logger.info(`[revalidate] skipping — WEBSITE_REVALIDATE_URL or REVALIDATE_SECRET not set`);
    return;
  }
  try {
    const res = await fetch(WEBSITE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-revalidate-secret": SECRET,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      logger.warn(`[revalidate] ${WEBSITE_URL} → ${res.status} ${await res.text()}`);
    } else {
      logger.info(`[revalidate] sent tags=${body.tags?.join(",") ?? ""} paths=${body.paths?.join(",") ?? ""}`);
    }
  } catch (err) {
    logger.error(`[revalidate] post failed: ${(err as Error).message}`);
  }
}

export default async function websiteRevalidate({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  // Build the tag list based on event name. Always invalidate broad list
  // tags so any consumer that reads the catalog gets fresh data.
  const tags = new Set<string>(["products:list", "pricing"]);
  const paths = new Set<string>();

  // Try to enrich with the specific handle for product/variant events so
  // the single-product page tag also gets cleared.
  const triggerId = event.data?.id;
  if (triggerId) {
    try {
      const query = container.resolve(ContainerRegistrationKeys.QUERY);
      let p: { handle?: string; collection?: { handle?: string } } | undefined;

      if (event.name?.startsWith("product-variant.")) {
        const { data } = await query.graph({
          entity: "variant",
          fields: ["id", "product.handle", "product.collection.handle"],
        });
        const v = (data as Array<{
          id: string;
          product?: { handle?: string; collection?: { handle?: string } };
        }> | undefined ?? []).find((x) => x.id === triggerId);
        p = v?.product;
      } else if (event.name?.startsWith("product.")) {
        const { data } = await query.graph({
          entity: "product",
          fields: ["handle", "collection.handle"],
          filters: { id: [triggerId] },
        });
        p = (data as Array<{ handle?: string; collection?: { handle?: string } }> | undefined)?.[0];
      }

      if (p?.handle) {
        tags.add(`product:${p.handle}`);
        paths.add(`/shop/${p.handle}`);
      }
      if (p?.collection?.handle) {
        tags.add(`collection:${p.collection.handle}`);
      }
    } catch (err) {
      // Resolution failed (e.g. product was deleted) — broad invalidation
      // already covers it.
      logger.warn(`[revalidate] could not resolve trigger ${triggerId}: ${(err as Error).message}`);
    }
  }

  if (event.name?.startsWith("product-collection.")) {
    tags.add("collections:list");
  }
  if (event.name?.startsWith("product-category.")) {
    tags.add("collections:list");
  }

  await postRevalidate(logger, { tags: Array.from(tags), paths: Array.from(paths) });
}

export const config: SubscriberConfig = {
  event: [
    "product.created",
    "product.updated",
    "product.deleted",
    "product-variant.created",
    "product-variant.updated",
    "product-variant.deleted",
    "product-collection.created",
    "product-collection.updated",
    "product-collection.deleted",
  ],
};
