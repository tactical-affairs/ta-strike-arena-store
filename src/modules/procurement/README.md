# Procurement module

Purchase orders, FIFO inventory lots, landed cost, and a COGS
ledger. Powers the inventory valuation, COGS-by-period, gross
margin, and slow-mover reports.

## How it fits into Medusa

This is a **custom top-level module** (not a provider under a core
module category like payment/fulfillment/tax). Registered in
`medusa-config.ts` with `resolve: "./src/modules/procurement"`.
Always loads — no env-var gate; inventory accounting is a
requirement, not an optional integration.

## Data model

Five entities, all in `models/`:

| Entity | Purpose |
|---|---|
| `Supplier` | Vendors we buy from (name, contact, lead time, currency) |
| `PurchaseOrder` | Header for an order to a supplier; statuses: `draft → submitted → partial → closed` (plus `canceled`) |
| `PurchaseOrderLine` | One SKU on a PO; stores `qty_ordered`, `qty_received`, `unit_cost` |
| `PoAdjustment` | Shipping / discount / tariff / other. Allocated across lines at receive time |
| `InventoryLot` | A batch of inventory at a specific landed cost — the FIFO layer. `qty_initial`, `qty_remaining`, `unit_cost`, `received_at`, `status ∈ {active, exhausted, damaged}`, `source ∈ {po, return_restock, opening_balance}` |
| `CogsEntry` | Ledger row: `qty × unit_cost` posted when a lot is consumed. `reversed_at` tracks returns |

Link files in `src/links/` wire three of these to core Medusa:
- `po_line.variant_id → product.variant`
- `inventory_lot.inventory_item_id → inventory.inventory_item`
- `cogs_entry.order_line_item_id → order.order_line_item`

## Workflows (service methods)

- **`createPurchaseOrderWithLines`** — admin creates a draft PO with
  its lines and optional adjustments in one call.
- **`computeLandedUnitCosts`** — allocates PO-level adjustments
  across lines by extended value (GAAP-standard); returns
  `{landed_unit_cost, allocated}` per line id.
- **`receivePurchaseOrder`** — for each received line, creates a new
  `InventoryLot` at the **landed** unit cost (supplier price +
  allocated share of current adjustments), bumps the line's
  `qty_received`, transitions PO status.
- **`consumeFifo`** — consumes active lots oldest-first for a
  fulfilled order line. Writes one `CogsEntry` per lot touched,
  marks lots `exhausted` at 0 remaining. Returns total cost + an
  `uncovered_qty` flag if lots ran out (indicates missing opening
  balance for that SKU).
- **`reverseCogsForReturn`** — reverses matching `CogsEntry` rows
  newest-first (LIFO on the reversal side), then creates one
  restock lot **per distinct cost segment** so cost basis is
  preserved across mixed-cost returns. `condition = "resellable"`
  produces active lots that re-enter the FIFO queue at "now";
  `condition = "damaged"` produces a `damaged` lot with
  `qty_remaining = 0` for loss reporting.
- **`getWeightedAverageCost`** — used by the product-detail cost-
  basis widget to show a stable blended cost.

## Subscribers

Two event subscribers in `src/subscribers/`:

- **`procurement-fulfillment-sync`** — on `order.fulfillment_created`,
  resolves each fulfilled line item's variant → inventory_item
  (via a two-step graph lookup) and calls `consumeFifo`.
- **`procurement-return-sync`** — on `order.return_received`,
  reads each return item's `metadata.condition` (defaults to
  `resellable`) and calls `reverseCogsForReturn`.

Both subscribers follow the same never-block-on-failure pattern as
`taxjar-order-sync`: try/catch per line, log and continue.

## Admin API

Routes under `src/api/admin/procurement/`:

| Method | Path | Purpose |
|---|---|---|
| GET / POST | `/suppliers` | List + create |
| GET / POST | `/purchase-orders` | List + create (lines + adjustments) |
| GET | `/purchase-orders/:id` | Detail with `landed_costs` map |
| POST | `/purchase-orders/:id/receive` | Partial or full receive |
| POST / DELETE | `/purchase-orders/:id/adjustments` | Add / remove post-hoc |
| GET | `/product-cost-basis?product_id=...` | Variant cost basis widget data |
| GET | `/reports/inventory-valuation` | Active lots × unit cost |
| GET | `/reports/cogs?from=&to=` | CogsEntry aggregation in window |
| GET | `/reports/gross-margin?from=&to=` | Revenue − COGS per variant |
| GET | `/reports/slow-movers?days=` | Active lots older than threshold |

## Admin UI

Under `src/admin/routes/`:

- `/suppliers` — list + add drawer
- `/purchase-orders` — list + create drawer (variant picker + lines + adjustments)
- `/purchase-orders/[id]` — detail with landed-cost column, receive modal, post-hoc adjustment UI
- `/reports` — tabbed page for all four reports with CSV export per tab

Plus one product-detail widget (`zone: "product.details.after"`) at
`src/admin/widgets/variant-cost-basis.tsx` showing the cost basis
panel on every product page.

## Shared lookup helper

`src/api/admin/procurement/reports/_display-lookup.ts` builds a
map from `inventory_item_id` to the display info of the owning
variant. "Owning" is determined by an SKU match against
`inventory_item.sku`, not by `variant.inventory_items.length`:

A single-component bundle variant has exactly one
`inventory_items[0]` pointing at its sole component's inventory
item — same shape as the component variant itself. Filtering by
length alone would mislabel a report row (e.g., Pro Target's
stock labeled as "Home Starter Package"). The SKU match is the
authoritative disambiguator.

## Seed + opening-balance bootstrap

`src/scripts/seed.ts` creates:
- One demo supplier ("Laser Ammo, Inc.")
- One opening-balance PO per non-bundle SKU at `unit_cost = 0.6 × price`
  (a placeholder — marked with a TODO for prod)
- An auto-receive call that creates a lot per SKU at the listed
  quantity, so FIFO consumption has something to chew through
  from the first fulfilled order

For production, replace the seed-time opening balance with a real
CSV import — see the "Opening balance" section in
`../../OPERATIONS.md` once that import script lands.

## Timing policy — post-hoc adjustment edits

Adjustments can be added (and removed) on a PO at any time, even
after a partial or full receipt. But:

> Edits affect only lots received **after** the change. Lots already
> created keep their original landed cost.

This mirrors accounting practice — we don't rewrite history. If a
shipping invoice arrives three weeks after you received the PO and
the amount differs from your estimate, the variance is absorbed
into future receipts or booked as a manual journal adjustment.

## Failure handling

The subscribers never block fulfillments or returns on a procurement-
side error — they log and continue. A COGS entry that failed to post
can be backfilled later via a `medusa exec` script.

## Useful exec script

`src/scripts/test-cogs.ts` drives `consumeFifo` and
`reverseCogsForReturn` directly against Pro Target lots to exercise
FIFO logic without placing a customer order. Run with:

```
npx medusa exec ./src/scripts/test-cogs.ts
```
