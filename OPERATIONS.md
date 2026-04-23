# Strike Arena Operations Manual

Standard operating procedures for running the Strike Arena storefront
end-to-end. Written for the person on shift — whether that's the owner,
a warehouse packer, or customer-support. Most tasks take under 5
minutes once you know where to click.

**This doc is a living SOP.** If a procedure here is wrong or the UI
moved, fix it in the same commit as whatever change triggered the
drift. Never let it rot — a wrong SOP is worse than none.

---

## Table of contents

- [The four systems](#the-four-systems)
- [Access + credentials](#access--credentials)
- [Morning routine](#morning-routine)
- [Products + inventory (receiving)](#products--inventory-receiving)
- [Order lifecycle](#order-lifecycle)
- [Fulfillment](#fulfillment)
- [Customer events](#customer-events)
  - [Order status inquiry](#order-status-inquiry)
  - [Address change before ship](#address-change-before-ship)
  - [Cancel an unshipped order](#cancel-an-unshipped-order)
  - [Cancel a shipped order](#cancel-a-shipped-order)
  - [Return (RMA)](#return-rma)
  - [Refund — full](#refund--full)
  - [Refund — partial](#refund--partial)
  - [Store credit](#store-credit)
  - [Exchange](#exchange)
- [Tax operations](#tax-operations)
- [Reconciliation](#reconciliation)
- [Troubleshooting](#troubleshooting)
- [Emergency procedures](#emergency-procedures)
- [Appendix: status references](#appendix-status-references)

---

## The four systems

Strike Arena runs on four integrated services. Every customer event
touches some subset of them — often all four. Know which one is
authoritative for what:

| System | What it's for | Authoritative for |
|---|---|---|
| **Medusa** (backend + admin) | Products, carts, orders, customers, fulfillment records | The order itself: line items, addresses, totals, state transitions |
| **FluidPay** | Credit-card authorization, capture, refund, void | Money movement — the actual charge/refund to the customer's card |
| **Shippo** | Live carrier rates at checkout, label purchase, tracking | Shipping labels + tracking numbers |
| **TaxJar** | Sales tax calculation at checkout + nexus monitoring + AutoFile | Tax collected + tax reporting to state revenue departments |

**Golden rule**: always work Medusa-first. When you act on an order in
Medusa Admin (refund, cancel, fulfill), the system propagates the
change to FluidPay/Shippo/TaxJar automatically. Acting directly in the
provider dashboards risks state drift between Medusa and the provider.

---

## Access + credentials

| System | URL | Login type |
|---|---|---|
| Medusa Admin | `https://<backend-domain>/app` (prod) or `http://localhost:9000/app` (dev) | Email + password (managed in Medusa, one account per employee) |
| FluidPay | `https://app.fluidpay.com` (prod) / `https://sandbox.fluidpay.com` (dev) | FluidPay merchant account |
| Shippo | `https://apps.goshippo.com` | Shippo account; toggle **Live** / **Test** in the top bar |
| TaxJar | `https://app.taxjar.com` | TaxJar account; sandbox and live keys are separate |

Your credentials for each of these systems will be set up by the
admin. If you don't have access to one of them, ask.

---

## Morning routine

Five minutes, every business morning, before any other work. Catches
overnight issues before the customer emails.

1. **Medusa Admin → Orders** — sort by "Created (newest)". Skim
   anything placed since yesterday. Click into any order with a
   non-standard status (canceled, requires action) and confirm it's
   already being handled.
2. **FluidPay dashboard → Transactions** — filter by "Authorized, not
   captured". Any authorization older than 5 days is at risk of
   expiring (FluidPay/card networks typically expire at 7-30 days
   depending on card brand). Capture or void before then.
3. **Shippo → Shipments** — any shipment labeled "Label purchased"
   more than 24 hours ago that hasn't been scanned by the carrier
   means it didn't actually ship. Find the physical box; re-hand off
   to the carrier.
4. **TaxJar → Dashboard** — check the "Economic Nexus Insights" card
   for any state approaching 80% of threshold. If flagged, add that
   state to the [tax-operations](#tax-operations) backlog.
5. **Medusa Admin → Inventory** — look for any SKU with stock ≤ 3.
   Reorder or mark [sold out](#deprecating--temporarily-disabling-a-product).

If any of these five produces an action, do it now before moving to
fulfillment work. Unhandled issues compound.

---

## Products + inventory (receiving)

### Adding a new product

Medusa Admin → **Products → Create product**.

1. **General** tab:
   - Title, subtitle, handle (slug), description.
   - Thumbnail + gallery images — upload to Medusa; they'll be pushed
     to R2 automatically (prod). Staging uses local file-local
     provider, which is fine for dev.
2. **Attributes** tab:
   - Weight (oz), length/width/height (inches) — **required**. Shippo
     rate calc breaks without these. Use the packaged-box dims, not
     the product's own dimensions.
3. **Variants** tab:
   - For single-variant products, use "Default" with SKU set to your
     internal SKU code. For multi-variant, define the option (e.g.,
     "Color") and each variant.
   - For each variant: set price (USD), select the "Standard Shipping"
     profile, and make sure it's linked to inventory.
4. **Organization** tab:
   - Assign category (e.g., "Laser Training Targets"), collection
     (e.g., "Home training kits"), and sales channel (Default Sales
     Channel covers the main storefront).
5. **Save as draft** first, review on `/shop/<handle>/` on the staging
   storefront (run `npm run sync-images` on the website repo if the
   new product isn't showing), then publish.

After publishing, run on the website repo:

```bash
cd ta-strike-arena-website
npm run sync-images   # regenerate image + variant + price caches
```

Commit the resulting changes to `src/data/*.generated.ts` and deploy:

```bash
npm run deploy:gh
```

The site rebuild is usually a few minutes; the new product page goes
live after the GitHub Pages deploy finishes.

### Updating inventory counts

Two triggers cause stock changes:

1. **Incoming shipment** (new stock from supplier): Medusa Admin →
   **Products → [SKU] → Variants → [variant] → Stock**, click **Edit**
   on the stock row for "Strike Arena Warehouse", update the
   quantity, save. Medusa records the adjustment as a stock-level
   reservation change.
2. **Manual correction** (physical count reveals a discrepancy): same
   path, but add a note in the variant metadata explaining the
   discrepancy so the reconciliation trail stays clean.

Medusa deducts inventory automatically when an order is placed; do not
adjust for outgoing orders manually.

### Editing prices / descriptions / images

- **Price** — Products → [product] → Variants → [variant] → Pricing →
  edit the USD row. Saves immediately. Picked up by the next
  `npm run deploy:gh` on the website (no backend restart needed).
- **Description** — Products → [product] → General → edit. Save. Same
  deploy cadence.
- **Images** — Products → [product] → Media tab → drag new images in
  / delete old ones. Reorder by dragging. The first image is the
  thumbnail. Save. Run `npm run sync-images` on the website and deploy.

**Rule**: every catalog edit should be followed by `npm run deploy:gh`
on the website repo within the same day. Otherwise the marketing site
and admin-UI drift until the next unrelated deploy.

### Deprecating / temporarily disabling a product

- **Temporarily out of stock**: set variant stock to 0. Storefront
  renders an "Out of stock" state automatically (falls back to email
  notify signup).
- **Permanent removal**: Medusa Admin → Products → [product] → **Delete**
  only if the product has never been ordered. Otherwise **Publish
  status → Draft** so it disappears from the storefront but the order
  history stays intact. Run `npm run sync-images` + deploy.

### Adding a new bundle

Bundles (e.g. "Pro Plus Package") are multi-SKU packages that ship as a
single box. In the current setup they're defined in code, not admin:

- `ta-strike-arena-store/src/scripts/seed.ts` — add a new `bundles[]`
  entry listing components and their quantities. The seed computes
  the bundle's parcel weight (sum of components) and box dims (max of
  components) automatically.
- After editing seed, deploy the backend. Never re-run `npm run seed`
  against prod. Instead, write a one-off `medusa exec
  ./src/scripts/add-bundle-xyz.ts` script that creates just the new
  bundle, and commit it. The seed file stays the source of truth for
  fresh dev environments.

---

## Order lifecycle

### What happens when an order comes in (automated, no action needed)

1. Customer places the order on the storefront checkout page.
2. Medusa records the order with `status=pending`,
   `payment_status=authorized` (FluidPay authorized but did not
   capture — see [note on capture mode](#capture-mode) below),
   `fulfillment_status=not_fulfilled`.
3. `order.placed` event fires → subscriber pushes the transaction to
   **TaxJar** for nexus tracking + filing.
4. Customer gets an order-confirmation email (EmailJS, configured on
   the website side).

After this, the order is waiting on you. Nothing's been shipped yet;
the card is only authorized (not captured).

### Capture mode

The backend runs with `FLUIDPAY_CAPTURE_MODE=authorize`, meaning
**capture happens separately from authorize**. You must capture the
payment before shipping (or at the latest, at fulfillment time —
otherwise the authorization expires and the capture fails).

To capture: Medusa Admin → [order] → **Payments section → Capture
payment → [enter amount — typically the full authorized amount] →
Confirm**. FluidPay immediately moves the money. Medusa updates
`payment_status` to `captured`.

If you don't capture within 5 days the authorization risks expiry.
After expiry you cannot capture — you'd have to ask the customer to
place a new order or manually charge via the FluidPay dashboard (both
customer-visible friction).

### Reviewing an order before fulfilling

In Medusa Admin → click into the order. Check:

1. **Shipping address** — looks legit? If a PO box, USPS is the only
   workable option; UPS/FedEx often reject.
2. **Payment** — `authorized` or `captured`, not `awaiting_action`.
3. **Line items** — all in stock (the order wouldn't have placed
   otherwise, but a manual inventory adjustment since then can
   oversell).
4. **Totals** — Subtotal + Shipping + Tax = Total. If they don't,
   something went sideways — check backend logs.
5. **Customer notes** — sometimes customers put instructions in the
   order-notes field.

If everything looks right, move to [fulfillment](#fulfillment).

If something's wrong: contact the customer. Do not ship a questionable
order to try to "be helpful" — it's easier to correct before ship than
after.

---

## Fulfillment

Triggers the Shippo label purchase, the charge capture, and the
customer's shipment-notification email. All from one Medusa Admin
screen.

### Create the fulfillment

Medusa Admin → [order] → **Create fulfillment**:

1. Select the items to fulfill (usually all of them).
2. Confirm the warehouse location (should default to "Strike Arena
   Warehouse").
3. Confirm / override the parcel dimensions if the packing is
   different from the variant default (e.g., multiple items in one
   bigger box).
4. **Create fulfillment** — this does three things in one step:
   - Sends a `POST /transactions/` to Shippo → label is purchased →
     tracking number stored on the fulfillment record.
   - Label URL (PDF) is saved on the fulfillment metadata.
   - The customer receives a shipment-notification email with the
     tracking link.
5. Click the printer icon next to the new fulfillment → **Print
   label**. Opens the Shippo label PDF in a new tab.
6. Print the packing slip from the same menu (Medusa generates it from
   the order).

### Packing

1. Pull the SKUs from shelves per the pick list.
2. Weigh the packed box; compare to the dims/weight sent to Shippo.
   If it's wildly different (>1 lb off, or a much bigger box), void
   the label ([see below](#void-a-label)) and recreate the
   fulfillment with the real measurements. A mismatched label will
   hit you with a "dimensional weight surcharge" on the next carrier
   invoice.
3. Tape the shipping label to the largest flat side. Place the
   packing slip inside.

### Carrier handoff

| Carrier | How to hand off |
|---|---|
| USPS | Drop at USPS retail counter or schedule pickup at [usps.com](https://usps.com). Packages up to 70 lb. |
| UPS | Schedule pickup via your UPS account or drop at a UPS Store / Access Point. |
| FedEx | Schedule pickup via `fedex.com/pickup` or drop at a FedEx Office. |

Tip: if you ship ≥3 packages/day, enable **recurring pickup** in each
carrier's portal. Saves a trip per day.

### After handoff — what happens automatically

- Carrier scans the label → Shippo posts a `track_updated` webhook to
  `/hooks/shippo` → Medusa advances fulfillment status through
  `shipped` → `delivered`.
- Customer sees real-time tracking on the tracking URL they already
  received.
- Nothing further for you to do unless a tracking event stalls for
  >72 hours — then see [troubleshooting](#troubleshooting).

### Void a label

If you bought a Shippo label but haven't handed the box to the
carrier yet (and Shippo hasn't scanned it):

1. Medusa Admin → [order] → [fulfillment] → **Cancel fulfillment**.
2. Medusa calls Shippo's `POST /refunds/` on the original transaction.
   Shippo refunds the label cost to your Shippo balance (usually
   within 21 days; USPS is faster than UPS/FedEx).
3. Medusa returns the reserved inventory to stock so the order can be
   re-fulfilled.
4. Create a new fulfillment with corrected parcel dims.

**Do not** void a label after the carrier has scanned it. Shippo will
reject the refund. At that point the shipment has to complete; if
it's wrong you're looking at a return + reship, not a void.

---

## Customer events

Each subsection below starts with a brief **What happens** summary,
then the concrete steps in each of the four systems.

### Order status inquiry

**What happens**: customer asks "where's my order?"

- **Medusa**: Admin → Orders → search by email / order-id → open order
  → copy the tracking URL from the fulfillment record.
- **FluidPay, Shippo, TaxJar**: no action.
- **Customer-facing**: send them the tracking URL. If there's no
  fulfillment yet, tell them the expected ship date (see the
  confirmation email you sent — typically "within 2 business days").

### Address change before ship

**What happens**: customer typos their address or asks to divert the
shipment before a label is purchased.

- **Medusa**: Admin → [order] → **Edit shipping address** → save. Only
  works while `fulfillment_status=not_fulfilled`.
- **FluidPay**: no action (the billing address on the authorization
  stays). If you need to re-authorize for some reason, void the
  existing auth and ask the customer to re-pay.
- **Shippo**: if a label was already bought, [void it](#void-a-label)
  and let the fulfillment recreation pick up the new address.
- **TaxJar**: if the new address is in a different state and affects
  tax, Medusa recomputes via `getTaxLines`. If the new tax amount
  differs from the old, the order total changes — you must either
  re-authorize (customer facing) or absorb/collect the difference
  out-of-band. Usually the simplest thing is: refund + re-order.
- **Customer-facing**: confirm the new address via email before
  shipping. Never ship to a verbally-confirmed address without it in
  writing.

### Cancel an unshipped order

**What happens**: customer asks to cancel before the package ships.

- **Medusa**: Admin → [order] → **⋯ menu → Cancel order** → confirm.
- **FluidPay**: Medusa sends a **void** on the authorization (if not
  yet captured) or a **refund** (if captured). Voids are free and
  instant; refunds take 3-5 business days to appear on the
  customer's statement.
- **Shippo**: if a label was bought, it gets voided as part of the
  cancel flow. If already scanned, you'll need to refuse delivery or
  issue a return label — see [cancel a shipped order](#cancel-a-shipped-order).
- **TaxJar**: subscriber fires `order.canceled` → `DELETE
  /transactions/orders/{id}`. The transaction is removed from
  nexus-threshold math and from the next filing. If a refund (not a
  void) was issued, TaxJar also handles the filed-tax offset
  automatically via AutoFile.
- **Customer-facing**: "Your order has been canceled and your card
  was refunded. Refunds typically take 3-5 business days to show on
  your statement."

### Cancel a shipped order

**What happens**: customer wants to cancel after the carrier has the
package but before they receive it.

1. Contact the carrier to attempt a delivery intercept (USPS Package
   Intercept, UPS / FedEx Hold at Location). Fees $15-20.
2. If the intercept succeeds, treat as a regular cancellation above
   once the package is returned.
3. If the intercept fails and the customer receives the package,
   treat as a return (next section).

### Return (RMA)

**What happens**: customer received the item and wants to send it back.

Return policy: 30 days from receipt, original packaging, customer pays
return shipping unless the item was defective (then we pay).

**Medusa**:
1. Admin → [order] → **Request return → select items → save**.
2. A return record is created with a Shippo return label (prepaid
   return) if we're paying shipping. If the customer pays, skip this
   step — they handle their own label.
3. Email the return label (if applicable) + instructions.
4. When the returned items physically arrive: Admin → [return] →
   **Receive return → confirm item condition → save**. Inventory is
   returned to stock automatically.

**FluidPay**: no automatic action on return receipt — refund is a
separate step (see next two sections).

**Shippo**: creates the return label via `POST /returns/` against the
original shipment. Customer uses it; carrier scans it; Shippo posts
webhook on delivery back to warehouse.

**TaxJar**: no action until you actually refund. At that point,
refund sync (below) updates TaxJar.

**Customer-facing**: "Your return has been received. Your refund of
$X will be processed within 2 business days to your original card."

### Refund — full

**What happens**: returning customer's entire order, full money-back.

- **Medusa**: Admin → [order] → **Payments → Refund → full amount →
  confirm**.
- **FluidPay**: Medusa calls `POST /api/transaction/{id}/refund`.
  Money goes back to the card in 3-5 business days.
- **Shippo**: no action (the original outbound label cost isn't
  refundable — that's a business cost of the return).
- **TaxJar**: a refund transaction is synced automatically via the
  refund subscriber path. The refunded sales tax is reported against
  the same filing period, reducing your next return.
- **Customer-facing**: email confirmation with refund amount + 3-5
  day ETA.

### Refund — partial

**What happens**: customer is keeping most of the order but wants a
partial refund (e.g., one item damaged, rest kept).

- **Medusa**: Admin → [order] → **Payments → Refund → specify amount
  → confirm**.
- **FluidPay**: partial refund against the captured transaction.
- **TaxJar**: sync with `sales_tax` adjusted proportionally (Medusa
  calculates the tax portion of the partial refund based on the items
  refunded).
- **Customer-facing**: explain which items are being refunded and why.

### Store credit

**What happens**: customer prefers store credit over a refund (often
faster for them; no card-refund delay).

Medusa v2 doesn't have a native store-credit module yet. Workaround:

1. In Medusa Admin → Customers → [customer] → **Add metadata → key:
   `store_credit`, value: `<amount>`**.
2. Email the customer a single-use promotion code for that amount
   (Promotions tab). Codes can be single-use-per-customer.
3. Do NOT refund via FluidPay. The money stays with us.
4. Document the store credit in a shared spreadsheet (until the
   native module lands) so it's not forgotten.

Phase-2 improvement: build a proper `store-credit` module using the
customer metadata + a promotion-auto-apply subscriber.

### Exchange

**What happens**: customer wants a different size/variant/item.

Simplest: treat as **refund + new order**. Easier to reason about
than an exchange workflow, and keeps accounting clean. Customer-facing
message: "I've refunded your original order — please place a new
order for the item you want, and I'll waive the return shipping on the
original."

If the customer insists on a swap-in-place, Medusa Admin supports
"Exchanges" under the order's **⋯ menu** — it creates a linked return
+ new-items fulfillment. Use it only if you're comfortable with the
extra complexity.

---

## Tax operations

### Monthly: review TaxJar transactions

Between the 1st and the 5th of each month:

1. TaxJar Dashboard → Transactions → filter previous month.
2. Count should match Medusa's `orders` placed in the same window
   (minus any cancellations). If not, investigate — usually a failed
   subscriber sync (check backend logs).
3. Cross-check total sales tax collected against Medusa's sum of
   `order.tax_total` for the month. Should match to the penny.

### Monthly/quarterly: filing

If **AutoFile** is enabled in TaxJar (recommended for WA and any
other state where you're registered):

- TaxJar handles the filing automatically on the state's schedule.
  WA is quarterly for most small sellers.
- You'll get an email from TaxJar confirming each filing. Keep these.
- The amount debited from your ACH account matches what TaxJar
  collected that period. Reconcile against your bank statement.

If AutoFile is NOT enabled:

- Log into the state revenue portal (WA: `dor.wa.gov`).
- File the return manually using TaxJar's pre-computed numbers.
- Pay the tax owed.

### Nexus threshold alert

**What happens**: TaxJar emails saying you've crossed (or are
approaching) 100% of another state's economic-nexus threshold.

1. **Do not ignore** — most states require registration within 30-60
   days of crossing.
2. Register for a sales-tax permit in that state (each state has its
   own portal; TaxJar's "Registration" service can do it for $100-200
   per state if you don't want to DIY).
3. Once registered, TaxJar Dashboard → State Settings → **Add
   state** → enter the permit number. From that point forward
   TaxJar returns `has_nexus=true` for that state and our storefront
   starts collecting.
4. (Optional) enable AutoFile for the new state.
5. Commit a note in the backlog so the next month's reconciliation
   expects the new state in the breakdown.

### Adding a new nexus state — technical impact

No code change needed. The provider checks with TaxJar at every
cart-refresh, so adding a state in TaxJar's dashboard takes effect
immediately. The storefront's Payment-step summary panel starts
showing the non-zero tax line for that state.

---

## Reconciliation

### Daily: FluidPay vs Medusa sales

End of each business day:

1. Medusa Admin → Orders → filter by date = today, `payment_status !=
   canceled`. Sum the `total` column.
2. FluidPay Dashboard → Transactions → filter by date = today, status
   = `authorized` or `captured`. Sum the amounts.
3. These should be equal. A discrepancy means either: (a) an
   authorization that Medusa created but FluidPay rejected
   silently, or (b) a FluidPay transaction that isn't linked to a
   Medusa order (shouldn't happen under normal ops; investigate).

### Monthly: three-way cross-check

1st of each month, for the previous month:

| Source | Metric |
|---|---|
| Medusa | Sum of `order.total` minus cancellations |
| FluidPay | Net captures (captures minus refunds) |
| TaxJar | Sales tax collected (sum of `sales_tax` across transactions) |

All three should reconcile to the same underlying sales volume.
Discrepancies > 1% warrant investigation.

### Year-end

Run a full year's order export from Medusa (Admin → Orders → export
CSV). Hand off to accountant with:

- Medusa CSV (all orders)
- FluidPay annual summary (transactions tab → export)
- TaxJar annual report (dashboard → Reports → annual)
- 1099-K from FluidPay (for the business)

---

## Troubleshooting

### Order stuck in "pending" with `authorized` payment for >5 days

Authorization is about to expire. Either:

- Fulfill and capture now (preferred — collects the money).
- Or void the authorization and cancel the order (if the customer
  isn't getting fulfilled).

### "Failed to create fulfillment" in Medusa Admin

Usually a Shippo-side issue. Check:

1. Medusa backend logs → search `[shippo]`. Common errors:
   - "Rate expired" → Shippo's rate IDs expire in ~20 minutes. Refresh
     the order page to get a new rate and retry.
   - "Parcel too large" → the computed packer parcel exceeds carrier
     limits. Override the parcel dims manually on the fulfillment
     screen.
2. Shippo Dashboard → Shipments → status of the most recent shipment
   for that order.

### Tax line missing on an order

Medusa tax module fell back to `tp_system` (zero rates). Causes:

- `TAXJAR_API_KEY` unset or wrong on the backend → check Railway env
  vars, restart backend.
- TaxJar API outage → they publish status at
  [status.taxjar.com](https://status.taxjar.com).
- Ship-to state isn't in the TaxJar nexus list for our account →
  expected behavior; no action.

Manual fix for a specific order: Medusa Admin → [order] → **Add tax
manually** using the published state rate. Rare and usually not worth
the effort for <$20 orders.

### Customer says "my card was declined"

1. Check FluidPay Dashboard → Transactions → filter by their email /
   timestamp. Look for the declined transaction and the decline reason
   (from the card network — typically "insufficient funds", "CVV
   mismatch", "AVS mismatch", "do not honor").
2. The customer needs to address the issue with their bank. We can't
   force a decline to clear.
3. Suggest: try a different card, or contact the bank to authorize.

### Tracking number stops updating for >72 hours

Common with USPS. Usually the package is moving fine, just not being
scanned.

1. First, confirm the label was actually handed off (ask the packer).
2. If >96 hours and still stuck: open a "missing package" case with
   the carrier.
3. If the customer is unhappy: offer a reship (before the package is
   confirmed lost), and file an insurance claim with Shippo (Shippo
   Insurance, if enabled) or the carrier directly.

### Sandbox vs live mode — which am I in?

Each dashboard has a different indicator:

| System | Sandbox indicator |
|---|---|
| FluidPay | URL is `sandbox.fluidpay.com`; dashboard has a yellow banner |
| Shippo | Top-right toggle reads "Test"; data is fake |
| TaxJar | Top-right selector reads "Sandbox"; separate nexus + transaction data |
| Medusa | Backend URL: `localhost:9000` or Railway-staging is sandbox; `<prod-domain>` is live |

**Before any real-money operation**, confirm you're in the live mode of
every system. It's easy to refund a sandbox transaction thinking
you're in prod.

---

## Emergency procedures

### Card processor outage (FluidPay down)

Storefront checkout will fail at the payment step. Customers see an
error.

1. Check [status.fluidpay.com](https://status.fluidpay.com) to
   confirm the outage.
2. Post a banner on the storefront homepage: "Our payment processor
   is temporarily unavailable — check back in an hour." (Add via a
   quick edit to `src/components/TopBanner.tsx` → deploy.)
3. Do NOT switch to a backup processor mid-outage; it's more risk
   than the outage itself.

### Shippo outage

Live rates and label purchase fail. Orders will still place but show
"Calculated at next step" on shipping. Ops actions:

1. Check [status.shippo.com](https://status.shippo.com).
2. For orders in the queue, wait it out if the outage is expected to
   resolve <2 hours. Otherwise, buy labels directly in each carrier's
   portal (USPS.com, UPS.com, FedEx.com) and manually enter the
   tracking number on the Medusa fulfillment.

### Medusa backend down

Storefront can't add to cart, show prices, or place orders. Static
product pages (shop/[handle]) still render (they're pre-built), but
checkout is dead.

1. Railway dashboard → Services → **Medusa** → check logs + restart.
2. If the DB is down, Railway Postgres dashboard → restart.
3. If neither helps, contact Railway support.

### Database corruption or accidental delete

Do not panic. Railway Postgres has automatic point-in-time-recovery
(PITR) backups:

1. Railway Postgres → Backups → restore to a point just before the
   incident.
2. Restoring creates a new database; point the backend at it via
   `DATABASE_URL`.
3. Redeploy the backend.
4. Reconcile any orders placed between the restore point and now —
   check FluidPay for authorizations that don't have a matching
   Medusa order, and reach out to those customers.

---

## Appendix: status references

### Medusa order statuses

| `status` | Meaning |
|---|---|
| `pending` | Order placed; default for every new order |
| `completed` | Fully fulfilled + paid; no open returns |
| `canceled` | Explicitly canceled (customer or ops) |
| `requires_action` | Payment or fulfillment flagged an issue (rare) |
| `archived` | Cold-storage — not commonly used |

### Medusa payment statuses

| `payment_status` | Meaning | Next action |
|---|---|---|
| `not_paid` | No payment attempted | Shouldn't happen post-checkout |
| `awaiting` | Payment session created but not completed | Customer didn't finish |
| `authorized` | FluidPay authorized, not captured | Capture at fulfillment |
| `captured` | Money moved from customer to us | Fulfill + ship |
| `partially_refunded` | Partial refund issued | — |
| `refunded` | Full refund issued | — |
| `canceled` | Void issued before capture | — |

### Medusa fulfillment statuses

| `fulfillment_status` | Meaning |
|---|---|
| `not_fulfilled` | No label / no pack |
| `partially_fulfilled` | Multi-shipment order, some shipped |
| `fulfilled` | Label purchased + packed, awaiting handoff |
| `shipped` | Carrier has it (first scan) |
| `delivered` | Customer has it |
| `partially_returned` | Some items coming back |
| `returned` | All items returned |
| `canceled` | Fulfillment canceled (label voided) |

### Useful links

- [Medusa Admin guide](https://docs.medusajs.com/user-guide)
- [Shippo dashboard docs](https://goshippo.com/docs)
- [FluidPay merchant portal docs](https://sandbox.fluidpay.com/docs)
- [TaxJar dashboard + AutoFile docs](https://support.taxjar.com/)
- State revenue portals (add as you register): WA `dor.wa.gov`, …
