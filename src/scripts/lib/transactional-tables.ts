/**
 * Single source of truth for which Postgres tables hold transactional /
 * operational / sensitive data — the stuff that should NOT be cloned from
 * production into a developer's machine.
 *
 * Used by two callers:
 *   - pull-prod.ts        passes these to `pg_dump --exclude-table-data` so
 *                         the data never leaves prod.
 *   - reset-finalize.ts   runs `TRUNCATE … RESTART IDENTITY CASCADE` against
 *                         them after restore as defense-in-depth, in case a
 *                         Medusa upgrade adds a new transactional table that
 *                         we forgot to add to this list.
 *
 * Rule for adding to this list:
 *   - Holds customer PII (orders, customers, addresses, etc.)?           → add it.
 *   - Holds in-flight commerce state (carts, payments, fulfillments)?    → add it.
 *   - Holds operational business data (suppliers, POs, COGS ledger)?     → add it.
 *   - Auth / API keys (re-injected with dev-specific values on reset)?   → add it.
 *
 * Rule for NOT adding:
 *   - Catalog content (products, variants, prices, images, collections)? → leave it.
 *   - Setup/config (regions, currencies, sales channels, tax regions,
 *     shipping options, stock locations, fulfillment providers)?         → leave it.
 *   - Inventory item registry (`inventory_item`)?                        → leave it
 *     (its `inventory_level` rows ARE reset to a dev default on reset,
 *      but that's a value reset, not a truncate — see reset-finalize.ts).
 *
 * Postgres glob patterns are supported (e.g. 'order*' matches 'order',
 * 'order_change', 'order_line_item', etc.). Be precise — overly broad
 * patterns can accidentally match catalog tables.
 *
 * If you're adding a NEW custom module that owns operational state, you must
 * add its tables here. Otherwise:
 *   1. Production data leaks into dev dumps every `npm run pull:prod`.
 *   2. Dev keeps stale operational data after every `npm run reset`.
 */
export const TRANSACTIONAL_TABLE_PATTERNS = [
  // Orders & related
  "order",
  "order_*",
  "draft_order",
  "draft_order_*",
  "return",
  "return_*",
  "swap",
  "swap_*",
  "claim",
  "claim_*",

  // Carts & sessions
  "cart",
  "cart_*",
  "payment_session",
  "payment_collection",
  "payment_collection_*",

  // Fulfillment & payment runtime records
  // (NOT fulfillment_set / fulfillment_provider / shipping_option / shipping_profile)
  "fulfillment",
  "fulfillment_item",
  "fulfillment_label",
  "fulfillment_address",
  "shipment",
  "shipment_*",
  "payment",
  "payment_*",

  // Customers (PII)
  "customer",
  "customer_*",
  "customer_address",

  // Auth (re-injected as dev-specific on reset)
  "user",
  "auth_identity",
  "provider_identity",
  "api_key",

  // Procurement (custom module — re-bootstrapped on reset)
  "supplier",
  "purchase_order",
  "purchase_order_line",
  "po_adjustment",
  "inventory_lot",
  "cogs_entry",

  // Misc operational
  "notification",
  "notification_*",
  "workflow_execution",
  "workflow_execution_*",
  "event",
  "event_*",
] as const;

export type TransactionalTablePattern = (typeof TRANSACTIONAL_TABLE_PATTERNS)[number];

/**
 * Build the `--exclude-table-data=…` arg list for pg_dump.
 * Each entry is wrapped to scope the match to the public schema.
 */
export function pgDumpExcludeArgs(
  patterns: readonly string[] = TRANSACTIONAL_TABLE_PATTERNS,
): string[] {
  return patterns.map((p) => `--exclude-table-data=public.${p}`);
}
