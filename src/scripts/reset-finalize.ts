/**
 * Phase 2 of `npm run reset` (run via `medusa exec`).
 *
 * Phase 1 (`reset-from-cache.ts`, run via ts-node) already:
 *   - dropped + recreated the dev DB,
 *   - restored `.cache/catalog.dump` (which carries prod's catalog tables
 *     plus full schema),
 *   - mirrored `.cache/images/` to `static/`,
 *   - ran TRUNCATE on transactional tables (defense in depth),
 *   - reset inventory_level rows to DEV_DEFAULT_STOCK,
 *   - rewrote image URLs to `http://localhost:9000/static/...`.
 *
 * This phase runs inside Medusa's container so it can talk to:
 *   - the api_key module (to insert a stable dev publishable key with a
 *     deterministic token, so the storefront's `.env` keeps working),
 *   - the procurement custom module (to bootstrap a clean opening-balance
 *     PO + FIFO lots for every non-bundle SKU, via the shared helper
 *     in lib/bootstrap-procurement.ts),
 *   - `query.graph` to discover variants + inventory_items.
 *
 * The dev admin user is NOT created here — that's done by the prep script
 * via `npx medusa user`, which is a separate CLI invocation.
 *
 * Required env vars (read from .env or the shell):
 *   DEV_PUBLISHABLE_KEY   — full pk_... token to inject (must match storefront)
 *   DEV_SUPPLIER_NAME     — optional, defaults to "Demo Supplier"
 *
 * If you change procurement bootstrap behavior, do it in
 * lib/bootstrap-procurement.ts so seed.ts and this script stay in sync.
 */

import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import {
  createApiKeysWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
} from "@medusajs/medusa/core-flows";
import { bootstrapOpeningBalance } from "./lib/bootstrap-procurement";

const DEFAULT_SUPPLIER_NAME = "Demo Supplier";

function redactToken(token: string): string {
  // Same format the api-key module uses internally:
  //   first 6 chars + "***" + last 3 chars
  return [token.slice(0, 6), token.slice(-3)].join("***");
}

export default async function resetFinalize({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const pg = container.resolve(ContainerRegistrationKeys.PG_CONNECTION);
  const salesChannelService = container.resolve(Modules.SALES_CHANNEL);
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION);

  const devPublishableKey = process.env.DEV_PUBLISHABLE_KEY;
  if (!devPublishableKey || !devPublishableKey.startsWith("pk_")) {
    throw new Error(
      "DEV_PUBLISHABLE_KEY must be set to a full pk_... token (matching the storefront's NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY).",
    );
  }

  // ── Resolve the default sales channel ─────────────────────
  const salesChannels = await salesChannelService.listSalesChannels({});
  if (salesChannels.length === 0) {
    throw new Error(
      "No sales channels found in the restored DB. The prod dump may be incomplete.",
    );
  }
  const defaultSalesChannel =
    salesChannels.find((c) => c.name === "Default Sales Channel") ?? salesChannels[0];

  // ── Inject dev publishable key ────────────────────────────
  // Strategy: create a publishable key via the workflow (gets a random
  // token), link it to the sales channel, then UPDATE the row to swap
  // the random token for our stable DEV_PUBLISHABLE_KEY. The redacted
  // column must match the new token (the api-key module uses it as a
  // narrowing index when authenticating).
  logger.info("[reset-finalize] Creating + retokenizing dev publishable key.");

  const { result: createdKeys } = await createApiKeysWorkflow(container).run({
    input: {
      api_keys: [{ title: "Webshop (dev)", type: "publishable", created_by: "" }],
    },
  });
  const createdKey = createdKeys[0];

  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: { id: createdKey.id, add: [defaultSalesChannel.id] },
  });

  await pg("api_key")
    .where({ id: createdKey.id })
    .update({
      token: devPublishableKey,
      redacted: redactToken(devPublishableKey),
      salt: "",
    });

  logger.info(
    `[reset-finalize] Dev publishable key ready (redacted=${redactToken(devPublishableKey)}).`,
  );

  // ── Resolve stock location ────────────────────────────────
  const stockLocations = await stockLocationService.listStockLocations({});
  if (stockLocations.length === 0) {
    throw new Error(
      "No stock locations found in the restored DB. The prod dump may be incomplete.",
    );
  }
  const stockLocation = stockLocations[0];

  // ── Build procurement lines from the just-restored catalog ────
  // For every variant whose SKU matches its inventory_item's SKU
  // (i.e. the variant directly OWNS that inventory_item — the
  // _display-lookup.ts heuristic for non-bundles), build one PO line
  // at qty = current stocked_quantity, unit_cost = 0.6 × variant price.
  logger.info("[reset-finalize] Building procurement opening-balance lines.");

  const { data: invItems } = await query.graph({
    entity: "inventory_item",
    fields: ["id", "sku"],
    filters: {} as never,
  });
  const invItemBySku = new Map<string, string>();
  for (const ii of invItems as Array<{ id: string; sku: string | null }>) {
    if (ii.sku) invItemBySku.set(ii.sku, ii.id);
  }

  const { data: variants } = await query.graph({
    entity: "product_variant",
    fields: ["id", "sku", "inventory_items.inventory.id"],
    filters: {} as never,
  });

  const { data: levels } = await query.graph({
    entity: "inventory_level",
    fields: ["inventory_item_id", "stocked_quantity"],
    filters: { location_id: stockLocation.id } as never,
  });
  const stockByInvItem = new Map<string, number>();
  for (const lvl of levels as Array<{
    inventory_item_id: string;
    stocked_quantity: number;
  }>) {
    stockByInvItem.set(lvl.inventory_item_id, lvl.stocked_quantity);
  }

  // Variant prices via calculated_price are pricing-context-dependent.
  // The simpler path: read directly from the price table for the variant's
  // default price set. Use a raw query to avoid pricing context entirely.
  const priceRows = (await pg.raw(
    `select pv.id as variant_id, pv.sku, p.amount
       from product_variant pv
       join product_variant_price_set pvps on pvps.variant_id = pv.id
       join price p on p.price_set_id = pvps.price_set_id
                   and p.currency_code = 'usd'
                   and p.deleted_at is null
                   and (p.rules_count is null or p.rules_count = 0)
      where pv.deleted_at is null`,
  )) as { rows: Array<{ variant_id: string; sku: string | null; amount: string }> };
  const priceByVariantId = new Map<string, number>();
  for (const r of priceRows.rows) {
    priceByVariantId.set(r.variant_id, Number(r.amount));
  }

  type VariantRow = {
    id: string;
    sku: string | null;
    inventory_items?: Array<{ inventory?: { id: string } }>;
  };

  const lines = (variants as VariantRow[])
    .map((v) => {
      if (!v.sku) return null;
      const ownedInvItemId = invItemBySku.get(v.sku);
      if (!ownedInvItemId) return null;
      // Disambiguate non-bundle: variant must directly own the inventory_item
      // whose SKU matches its own. Bundles will have inventory_items linked
      // to their components' items (which have different SKUs).
      const directlyOwns = (v.inventory_items ?? []).some(
        (link) => link.inventory?.id === ownedInvItemId,
      );
      if (!directlyOwns) return null;
      const qty = stockByInvItem.get(ownedInvItemId) ?? 0;
      const price = priceByVariantId.get(v.id);
      if (!price || price <= 0) return null;
      const unitCost = Math.round(price * 0.6 * 100) / 100;
      return {
        variant_id: v.id,
        inventory_item_id: ownedInvItemId,
        qty,
        unit_cost: unitCost,
      };
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  logger.info(
    `[reset-finalize] Bootstrapping procurement with ${lines.length} non-bundle lines.`,
  );

  await bootstrapOpeningBalance({
    container,
    logger,
    stockLocationId: stockLocation.id,
    supplier: {
      name: process.env.DEV_SUPPLIER_NAME ?? DEFAULT_SUPPLIER_NAME,
      contact_name: "Dev Reset Bootstrap",
      default_currency: "usd",
      lead_time_days: 14,
      notes: "Auto-created by `npm run reset`. Wiped + rebuilt on every reset.",
    },
    lines,
  });

  logger.info("[reset-finalize] Done.");
}
