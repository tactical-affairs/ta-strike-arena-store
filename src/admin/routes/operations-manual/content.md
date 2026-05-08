# Operations Manual

Standard operating procedures for running the Strike Arena storefront
day-to-day. Written for ops staff — packers, customer-support,
inventory. Most tasks take under 5 minutes once you know where to
click.

This manual lives inside the Medusa Admin so you don't have to leave
your tools to look something up. If a procedure here is wrong or the
UI moved, flag it to a developer — wrong instructions cause more
damage than missing ones.

The full engineering-and-ops runbook (with infra, deploys, and
troubleshooting that escalates to dev) lives in the repo as
`OPERATIONS.md`. This in-app version is the ops-only subset.

## Daily checklist

Five minutes, every business morning, before any other work. Catches
overnight issues before the customer emails.

1. **Orders → sort by Created (newest)**. Skim anything placed since
   yesterday. Click into any order with a non-standard status
   (canceled, requires action) and confirm it's already being
   handled.
2. **FluidPay dashboard → Transactions** — filter "Authorized, not
   captured". Any authorization older than 5 days is at risk of
   expiring. Capture or void before then.
3. **Shippo → Shipments** — any shipment labeled "Label purchased"
   more than 24 hours ago that hasn't been scanned by the carrier
   means it didn't actually ship. Find the physical box and re-hand
   off to the carrier.
4. **TaxJar → Dashboard** — check "Economic Nexus Insights" for any
   state approaching 80% of threshold. If flagged, see
   [Nexus threshold alert](#nexus-threshold-alert).
5. **Medusa Admin → Inventory** — look for any SKU with stock ≤ 3.
   Reorder or mark sold-out.

If any of these five produces an action, do it now before moving to
fulfillment work. Unhandled issues compound.

## Customer events

### Finding a customer's order

Most customer events start with this — they email asking about a
specific order, you need to pull it up. The Medusa Admin search is
forgiving about what you put in.

Sidebar → **Orders**. The search box at the top accepts:

- **Order display ID** like `1042` or `#1042` (the customer-facing
  number on their confirmation email).
- **Customer email** like `jane@example.com` (matches the order's
  email field, not the customer record's primary email — they're
  usually the same but not always for guest checkouts).
- **Customer name** (first or last).

Filters in the right rail: status, payment status, fulfillment
status, date range. Useful when the customer can't remember the
order number — search by their name + narrow to "last 30 days".

Once you've opened the order, the most useful things to scan:

- Top header: order number, total, payment status, fulfillment status
- **Payments** section: amount authorized, amount captured, refunds,
  link to FluidPay transaction
- **Fulfillment** section: tracking number + Shippo tracking URL
- **Customer** section: shipping address, billing address, customer
  notes from the checkout form
- **Activity** timeline at the bottom: every status transition with
  timestamps — answers "when did this ship?" definitively

### Order status inquiry

**What happens**: customer asks "where's my order?"

- **Medusa**: open the order via the lookup above, copy the tracking
  URL from the fulfillment record.
- **Customer-facing**: send them the tracking URL. If there's no
  fulfillment yet, tell them the expected ship date (typically
  "within 2 business days").

### Address change before ship

**What happens**: customer typos their address or asks to divert the
shipment before a label is purchased.

- **Medusa**: Admin → [order] → **Edit shipping address** → save.
  Only works while `fulfillment_status=not_fulfilled`.
- **FluidPay**: no action (the billing address on the authorization
  stays).
- **Shippo**: if a label was already bought, [void it](#void-a-label)
  and let the fulfillment recreation pick up the new address.
- **TaxJar**: if the new address is in a different state and affects
  tax, Medusa recomputes via `getTaxLines`. If the new tax amount
  differs from the old, the order total changes — the simplest
  workaround is refund + re-order.
- **Customer-facing**: confirm the new address via email before
  shipping. Never ship to a verbally-confirmed address without it in
  writing.

### Cancel an unshipped order

**What happens**: customer asks to cancel before the package ships.

- **Medusa**: Admin → [order] → **⋯ menu → Cancel order** → confirm.
- **FluidPay**: Medusa sends a **void** on the authorization (if not
  yet captured) or a **refund** (if captured). Voids are free and
  instant; refunds take 3-5 business days.
- **Shippo**: if a label was bought, it gets voided as part of the
  cancel flow. If already scanned, see
  [Cancel a shipped order](#cancel-a-shipped-order).
- **TaxJar**: handled automatically via the `order.canceled`
  subscriber.
- **Customer-facing**: "Your order has been canceled and your card
  was refunded. Refunds typically take 3-5 business days to show on
  your statement."

### Cancel a shipped order

**What happens**: customer wants to cancel after the carrier has the
package but before they receive it.

1. Contact the carrier to attempt a delivery intercept (USPS Package
   Intercept, UPS / FedEx Hold at Location). Fees $15-20.
2. If the intercept succeeds, treat as a regular cancellation.
3. If the intercept fails and the customer receives the package,
   treat as a return.

### Return (RMA)

**What happens**: customer received the item and wants to send it
back.

Return policy: 30 days from receipt, original packaging, customer
pays return shipping unless the item was defective (then we pay).

1. Admin → [order] → **Request return → select items → save**.
2. A return record is created with a Shippo return label (prepaid
   return) if we're paying shipping. If the customer pays, skip this
   step — they handle their own label.
3. Email the return label (if applicable) + instructions.
4. When the returned items physically arrive: Admin → [return] →
   **Receive return → confirm item condition → save**. Inventory
   goes back to stock automatically; the related COGS entries are
   reversed.

The condition is set via the return item's `metadata.condition`
field (resellable / damaged). Default if unset: `resellable`.
Resellable items create a new active inventory lot at the original
cost; damaged items reverse COGS but don't restock.

**Refund**: refunds aren't issued automatically when you receive a
return. See [Issuing a refund](#issuing-a-refund) for the next step.

**Customer-facing**: "Your return has been received. Your refund of
$X will be processed within 2 business days to your original card."

### Issuing a refund

Three modes — pick the one that fits, then follow that section.

| Mode | When to use |
|---|---|
| **Full refund** | Customer returned the whole order, or order is being canceled before any value was delivered. |
| **Partial refund** | Customer keeps most of the order; one item arrived damaged or was missing. Common after a partial return. |
| **Store credit** | Customer prefers a credit they can use again (often faster than waiting on a card refund). |

#### Full refund

- **Medusa**: Admin → [order] → **Payments → Refund → full amount →
  confirm**.
- **FluidPay**: money goes back to the card in 3-5 business days.
- **Shippo**: no action (the original outbound label cost isn't
  refundable).
- **TaxJar**: refund transaction is synced automatically. The
  refunded sales tax reduces your next return.
- **Customer-facing**: "Your refund of $X has been issued. It
  typically takes 3-5 business days to appear on your statement."

#### Partial refund

- **Medusa**: Admin → [order] → **Payments → Refund → specify amount
  → confirm**. Match the dollars to the items being credited (item
  unit price × qty + their pro-rated tax + any return shipping if
  you're absorbing that). The order detail page shows the
  breakdown to copy from.
- **FluidPay**: partial refund against the captured transaction.
- **TaxJar**: sync with `sales_tax` adjusted proportionally.
- **Customer-facing**: be explicit about which items are being
  refunded so the dollar amount makes sense. Sample: "I've refunded
  $48.50 for the broken laser cartridge — that's the item subtotal
  of $44.99 plus $3.51 in WA sales tax. Your other items are yours
  to keep."

#### Store credit

Medusa v2 doesn't have a native store-credit module yet, so this is
a manual workaround:

1. **Customers → [customer] → Add metadata** with key `store_credit`
   and value = the credit amount in dollars (e.g. `50.00`).
2. **Promotions → Create promotion**:
   - Type: fixed amount
   - Value: the credit amount
   - Code: a unique single-use code (e.g. `CREDIT-COLIN-50`)
   - Limit: 1 use, restricted to that customer's email
3. Email the customer the code and the rules.
4. **Do NOT** refund via FluidPay — the money stays with us, the
   credit is the alternative.
5. Log the credit in the shared store-credit spreadsheet so it's
   not forgotten.

### Exchange

**What happens**: customer wants a different size/variant/item.

Simplest: treat as **refund + new order**. Easier to reason about
than an exchange workflow, and keeps accounting clean. Sample:
"I've refunded your original order — please place a new order for
the item you want, and I'll waive the return shipping on the
original."

If the customer insists on a swap-in-place, Medusa Admin supports
"Exchanges" under the order's **⋯ menu** — it creates a linked
return + new-items fulfillment. Use it only if you're comfortable
with the extra complexity.

## Order lifecycle

### What happens when an order comes in

Automated, no action needed:

1. Customer places the order on the storefront checkout page.
2. Medusa records the order with `status=pending`,
   `payment_status=authorized` (FluidPay authorized but did not
   capture — see [Capture mode](#capture-mode)),
   `fulfillment_status=not_fulfilled`.
3. The customer receives an order-confirmation email with their
   order number, line items, totals, and shipping address.
4. The order shows up in your queue, waiting on you.

### Capture mode

The backend runs with capture-on-fulfillment, meaning **capture
happens separately from authorize**. You must capture the payment
before shipping (or at the latest, at fulfillment time — otherwise
the authorization expires and the capture fails).

To capture: Medusa Admin → [order] → **Payments section → Capture
payment → [enter amount, typically the full authorized amount] →
Confirm**. FluidPay immediately moves the money. Medusa updates
`payment_status` to `captured`.

If you don't capture within 5 days the authorization risks expiry.
After expiry you cannot capture — you'd have to ask the customer to
place a new order.

### Reviewing an order before fulfilling

In Medusa Admin → click into the order. Check:

1. **Shipping address** — looks legit? If a PO box, USPS is the only
   workable option; UPS/FedEx often reject.
2. **Payment** — `authorized` or `captured`, not `awaiting_action`.
3. **Line items** — all in stock (the order wouldn't have placed
   otherwise, but a manual inventory adjustment since then can
   oversell).
4. **Totals** — Subtotal + Shipping + Tax = Total. If they don't,
   flag to the developer before fulfilling.
5. **Customer notes** — sometimes customers put instructions in the
   order-notes field.

If everything looks right, move to [Fulfillment](#fulfillment).

If something's wrong: contact the customer. Do not ship a
questionable order to "be helpful" — it's easier to correct before
ship than after.

## Fulfillment

Triggers the Shippo label purchase, the charge capture, and the
customer's shipment-notification email. All from one Medusa Admin
screen.

### Create the fulfillment

Medusa Admin → [order] → **Create fulfillment**:

1. Select the items to fulfill (usually all of them).
2. Confirm the warehouse location.
3. Confirm / override the parcel dimensions if the packing differs
   from the variant default.
4. **Create fulfillment** — this does three things in one step:
   - Buys the Shippo label → tracking number stored on the
     fulfillment record.
   - Saves the label PDF on the fulfillment metadata.
   - The customer receives a shipment-notification email with the
     tracking link.
5. Click the printer icon next to the new fulfillment → **Print
   label**.
6. Print the packing slip from the same menu.

### Packing

1. Pull the SKUs from shelves per the pick list.
2. Weigh the packed box; compare to the dims/weight sent to Shippo.
   If it's wildly different (>1 lb off, or a much bigger box),
   [void the label](#void-a-label) and recreate the fulfillment with
   real measurements. A mismatched label hits you with a
   "dimensional weight surcharge" on the next carrier invoice.
3. Tape the shipping label to the largest flat side. Place the
   packing slip inside.

### Carrier handoff

| Carrier | How to hand off |
|---|---|
| USPS | Drop at USPS retail counter or schedule pickup at usps.com. Packages up to 70 lb. |
| UPS | Schedule pickup via your UPS account or drop at a UPS Store / Access Point. |
| FedEx | Schedule pickup via fedex.com/pickup or drop at a FedEx Office. |

Tip: if you ship ≥3 packages/day, enable **recurring pickup** in
each carrier's portal. Saves a trip per day.

### After handoff

- Carrier scans the label → Shippo posts a tracking webhook → Medusa
  advances fulfillment status through `shipped` → `delivered`.
- Customer sees real-time tracking on the URL they already received.
- Nothing further for you to do unless a tracking event stalls for
  >72 hours — then see
  [Tracking number stops updating](#tracking-number-stops-updating-for-72-hours).

### Void a label

If you bought a Shippo label but haven't handed the box to the
carrier yet (and Shippo hasn't scanned it):

1. Medusa Admin → [order] → [fulfillment] → **Cancel fulfillment**.
2. Shippo refunds the label cost to your Shippo balance (usually
   within 21 days; USPS faster than UPS/FedEx).
3. Medusa returns the reserved inventory to stock so the order can
   be re-fulfilled.
4. Create a new fulfillment with corrected parcel dims.

**Do not** void a label after the carrier has scanned it. Shippo
will reject the refund. At that point the shipment has to complete;
if it's wrong you're looking at a return + reship, not a void.

## Inventory

### Adding a new product

Medusa Admin → **Products → Create product**.

1. **General** tab: title, subtitle, handle (slug), description,
   thumbnail, gallery images.
2. **Attributes** tab: weight (oz), length/width/height (inches) —
   **required**. Shippo rate calc breaks without these. Use the
   packaged-box dims, not the product's own dimensions.
3. **Variants** tab: SKU, price (USD), shipping profile, inventory
   linkage.
4. **Organization** tab: category, collection, sales channel.
5. **Save as draft** first, review on the staging storefront, then
   publish.

After publishing, ask the developer to redeploy the storefront —
new products appear on strikearena.net only after the next deploy.

### Updating inventory counts

For incoming stock from a supplier, **always go through a Purchase
Order** (see [Receiving stock](#receiving-stock)) — that's how
landed cost gets recorded.

For a manual correction after a physical count: Medusa Admin →
**Products → [SKU] → Variants → [variant] → Stock**, click **Edit**
on the stock row, update, save. Add a note in the variant metadata
explaining the discrepancy so the audit trail stays clean.

Medusa deducts inventory automatically when an order is placed; do
not adjust for outgoing orders manually.

### Editing prices, descriptions, images

- **Price**: Products → [product] → Variants → [variant] → Pricing
  → edit the USD row.
- **Description**: Products → [product] → General → edit.
- **Images**: Products → [product] → Media tab → drag in / delete /
  reorder. The first image is the thumbnail.

Catalog edits require a storefront redeploy to go live. Ask the
developer after a round of edits — strikearena.net drifts from
admin until the next deploy.

### Deprecating a product

- **Temporarily out of stock**: set variant stock to 0. Storefront
  renders an "Out of stock" state with an email-notify signup.
- **Permanent removal**: Medusa Admin → Products → [product] →
  **Delete** only if the product has never been ordered. Otherwise
  **Publish status → Draft** so the storefront hides it but order
  history stays intact.

### Issuing a unit for non-sales reasons

Sidebar → **Issue inventory**. Use this when stock leaves the
warehouse for a reason that isn't a customer order — demos,
samples, internal testing, post-receipt damage, write-offs.

Why this page exists: the manual stock-quantity edit on the
inventory page bypasses the FIFO ledger and never posts a COGS
entry. So your reports drift from physical reality. Issue
inventory does the same physical decrement *and* walks the FIFO
lots, posting a categorized COGS entry — the books stay accurate
without an order existing.

To issue:

1. **Variant** — typeahead. Search by product name, variant title,
   or SKU.
2. **Location** — defaults to the only location if there's just
   one; otherwise pick. The page shows live "N units available at
   this location" once you've picked both.
3. **Quantity** — must be ≤ the available number shown.
4. **Reason** — pick the closest match:
   - **Demo** — unit at a trade show, range day, sales call. Often
     comes back; if it does, ask a developer for an inventory
     adjustment that creates a `return_restock` lot.
   - **Sample** — sent to a reviewer, content creator, retailer
     prospect. Usually doesn't come back.
   - **Internal use** — consumed by the team for QA, training,
     reference.
   - **Damaged (post-receipt)** — broken in the warehouse after
     the PO was received in good condition. See
     [When a PO arrives with damaged items](#when-a-po-arrives-with-damaged-items)
     for damage on the receiving side.
   - **Write-off** — catch-all (lost, expired, destroyed in
     internal moves).
5. **Notes** — write enough to find this row again in 6 months.
   Who took it, where it went, any case/PO numbers.
6. **Issue from inventory**.

The "Recent issues" panel at the bottom shows what's been issued
this session. Available quantity decrements optimistically so you
can issue another unit of the same variant without a refresh.

## Purchase orders

Every unit we sell is tied to a specific purchase order at a
specific landed cost (unit cost from the supplier plus allocated
shipping, tariffs, and discounts). That's what powers COGS, gross
margin, and inventory valuation reports.

### Adding or editing a supplier

Sidebar → **Suppliers**. The list shows every vendor we buy from
along with their default lead time and currency.

To add a new supplier:

1. **Add supplier**.
2. Fill in **Name**, **Contact email**, **Contact phone**, default
   **Lead time** in days (used as the prefilled "expected delivery"
   on new POs), default **Currency**.
3. **Save**.

To edit an existing supplier: click into the row, change fields,
**Save**. Edits are non-destructive — historical POs keep their
original supplier snapshot.

To deactivate: edit and toggle **Active** off. Inactive suppliers
don't show up in the new-PO picker but stay attached to historical
POs.

### Creating a purchase order

Sidebar → **Purchase Orders → New purchase order**.

1. **PO number** (optional). Leave blank to auto-generate. If you
   have an external PO from the supplier or your own internal
   numbering scheme, type it in here so the records line up. PO
   numbers must be unique.
2. Pick the supplier.
3. Optional: fill in expected delivery date and notes.
4. Add line items — variant typeahead, quantity, unit cost (pre-
   shipping, pre-tariff). Click **Add line** for each.
5. **Adjustments** — if the supplier is charging for shipping,
   applying a discount, or passing on tariffs/duties, add separate
   lines (shipping / discount / tariff / other), enter the amount
   and an optional note.
6. **Create PO**. Status starts at `open`.

### Editing or canceling an open PO

While the PO is `open` (no items received) or `partial` (some items
received):

- **Edit (header)** — PO number, supplier, expected delivery, notes.
- **Per-line edit** — type a new quantity or unit cost into the
  line's input fields; the **Save** button activates when there's a
  pending change. You can't drop quantity below whatever has
  already been received.
- **Per-line remove** (× icon) — only on lines with zero receipts.
- **Add line** — same form as PO creation, below the lines table.
- **Cancel PO** — terminal. Refused if any line has been received.

Closed POs are read-only — the lots are in inventory and no edit
could change that history.

### Receiving stock

When the shipment arrives:

1. Sidebar → **Purchase Orders** → click the PO number.
2. **Receive items**.
3. Pick the location.
4. Enter the quantity received on each line. Lines can be fully or
   partially received; partial receipts keep the PO in `partial`
   status until the rest lands.
5. **Record receipt** — this:
   - Creates a new FIFO inventory lot at the **landed** cost
     (supplier unit cost + allocated share of PO adjustments by
     extended value).
   - Bumps Medusa's on-hand inventory for that location.
   - Updates the PO line's received count + PO status.

### Adding an adjustment post-hoc

Shipping invoices often arrive after the PO was created and
received. That's fine:

1. Open the PO detail page.
2. In the **Adjustments** section, pick the type and amount → **Add**.
3. The table shows the new landed unit cost with the delta from the
   original (e.g., `$152.00 (+$2.00)`).

**Important rule**: adjustments only affect lots received **after**
the change. Lots already received keep their original landed cost.
Variance is absorbed into future receipts or posted as a manual
journal entry by the accountant.

### When a PO arrives with damaged items

Two-step flow that keeps the PO record clean and the damage properly
costed.

**What you receive**: 10 units ordered, 8 are perfect, 2 arrived
broken (water damage, crushed packaging, dead-on-arrival, etc.).

**Wrong way**: receive 8 and pretend the supplier shipped only 8.
The PO record drifts from the supplier's invoice; the landed-cost
math goes sideways; there's no audit trail of the damage.

**Right way**:

1. **Receive the full quantity** (10) on the PO. All 10 units are
   now in inventory at full landed cost. This matches the
   supplier's invoice.
2. **Sidebar → Issue inventory**. Pick the variant, the location,
   quantity = 2, **Reason = Damaged (post-receipt)**. In the notes,
   reference the supplier and PO number ("2 units broken on
   arrival, supplier ACME, PO-1042; pictures in
   support@strikearena.net"). Submit.
3. The 2 units come off the books at their landed cost — a COGS
   entry posts under reason `damaged_post_receipt`, and on-hand
   inventory drops to 8.

When the supplier eventually credits us for the damage, post that
as a discount adjustment on the original PO. Together the flows
land the bookkeeping correctly: the PO records what was bought,
the issue records what was lost, the discount records what was
refunded.

### Viewing cost basis per product

Sidebar → **Products** → open any product. The **Cost basis (FIFO)**
panel shows per-variant: active lot count, qty on hand, weighted-
average cost, total inventory value.

For a full per-variant breakdown across all products, use the
[Inventory valuation report](#inventory-valuation).

## Tax operations

### Monthly: review TaxJar transactions

Between the 1st and 5th of each month:

1. TaxJar Dashboard → Transactions → filter previous month.
2. Count should match Medusa's orders placed in the same window
   (minus cancellations). If not, escalate.
3. Cross-check total sales tax collected in TaxJar against Medusa's
   "Tax" column summed for the month. Should match to the penny.

### Monthly/quarterly filing

If **AutoFile** is enabled in TaxJar (recommended for WA and any
state where you're registered):

- TaxJar handles the filing automatically. WA is quarterly for
  most small sellers.
- You'll get a confirmation email per filing — keep these.
- The amount debited from your ACH account matches what TaxJar
  collected. Reconcile against your bank statement.

If AutoFile is NOT enabled:

- Log into the state revenue portal (WA: dor.wa.gov).
- File the return manually using TaxJar's pre-computed numbers.
- Pay the tax owed.

### Nexus threshold alert

**What happens**: TaxJar emails saying you've crossed (or are
approaching) 100% of another state's economic-nexus threshold.

1. **Do not ignore** — most states require registration within
   30-60 days of crossing.
2. Register for a sales-tax permit in that state. Each state has
   its own portal; TaxJar's "Registration" service can do it for
   $100-200 per state if you don't want to DIY.
3. Once registered, TaxJar Dashboard → State Settings → **Add
   state** → enter the permit number. Storefront starts collecting
   immediately.
4. (Optional) enable AutoFile for the new state.
5. Tell the developer + accountant so the next month's
   reconciliation expects the new state in the breakdown.

## Reconciliation

### Daily: FluidPay vs Medusa sales

End of each business day:

1. Medusa Admin → Orders → filter date = today,
   `payment_status != canceled`. Sum the `total` column.
2. FluidPay Dashboard → Transactions → filter date = today, status
   = `authorized` or `captured`. Sum amounts.
3. These should be equal. A discrepancy means either an
   authorization Medusa created that FluidPay rejected silently, or
   a FluidPay transaction not linked to a Medusa order. Investigate.

### Monthly: three-way cross-check

1st of each month, for the previous month:

| Source | Metric |
|---|---|
| Medusa | Sum of `order.total` minus cancellations |
| FluidPay | Net captures (captures minus refunds) |
| TaxJar | Sales tax collected (sum of `sales_tax` across transactions) |

All three should reconcile to the same underlying sales volume.
Discrepancies > 1% warrant investigation.

## Reports

Sidebar → **Reports** — four reports with a CSV export button on
each.

### Inventory valuation

**What it tells you**: dollar value of everything sitting in the
warehouse, at FIFO cost.

Columns: product, SKU, active lots, qty on hand, weighted-average
unit cost, inventory value. Total at the bottom.

**When to run**: month-end and year-end for the accountant
(balance-sheet "inventory on hand"). Also during the
[Daily checklist](#daily-checklist) if anything looks off.

### COGS by period

**What it tells you**: cost of goods sold within a date range, by
product.

Columns: product, SKU, qty sold, gross COGS, reversed (returns),
net COGS. Defaults to the current calendar month.

**When to run**: monthly, on the 1st-5th, for the previous month.
Hand the CSV to the accountant for the income-statement COGS line.

### Gross margin

**What it tells you**: revenue minus COGS by product, with margin %.

Columns: product, SKU, qty sold, revenue, COGS, gross profit,
margin %. Revenue is pre-tax, pre-shipping (item-level unit_price ×
qty).

**When to run**: monthly, alongside COGS. Look for products with
low or negative margins — typical causes: supplier cost rose
without a price increase, missing PO adjustment, storefront pricing
error.

### Slow movers

**What it tells you**: active inventory lots older than N days that
still have units remaining.

Columns: product, SKU, lot ID, received-at date, age in days, qty
remaining, unit cost, stuck value.

**When to run**: monthly. Default threshold 90 days. Trim to 180
for slow-turn items, 30 for fast-turn.

**What to do with it**:

- 30-60 days stuck: consider promotion / bundle pricing.
- 60-180 days: markdown / clearance.
- 180+ days: write-off candidate. Issue them via Issue inventory
  → Write-off so they exit FIFO and show up in loss reports.

## Troubleshooting

Customer-facing issues that ops can resolve. For server-side
outages or "the admin won't load" — escalate to a developer.

### Order stuck in "pending" with `authorized` payment for >5 days

Authorization is about to expire. Either:

- Fulfill and capture now (preferred — collects the money).
- Or void the authorization and cancel the order (if not getting
  fulfilled).

### Customer says "my card was declined"

1. Check FluidPay Dashboard → Transactions → filter by their email
   / timestamp. Look for the declined transaction and the decline
   reason from the card network — typically "insufficient funds",
   "CVV mismatch", "AVS mismatch", "do not honor".
2. The customer needs to address it with their bank. We can't force
   a decline to clear.
3. Suggest: try a different card, or contact the bank to authorize.

### Tracking number stops updating for >72 hours

Common with USPS. Usually the package is moving fine, just not
being scanned.

1. First, confirm the label was actually handed off (ask the
   packer).
2. If >96 hours and still stuck, open a "missing package" case with
   the carrier.
3. If the customer is unhappy: offer a reship (before the package
   is confirmed lost), and file an insurance claim with Shippo or
   the carrier directly.

### Tax line missing on an order

Possible causes, in order of likelihood:

1. **Ship-to state isn't in the TaxJar nexus list** — expected for
   states where we're not registered. No action.
2. **TaxJar outage** — check status.taxjar.com. Orders placed
   during the outage will be missing tax; new orders resume after
   recovery.
3. **Configuration issue on the backend** — escalate to the
   developer.

Manual fix for a specific order: Medusa Admin → [order] → **Add
tax manually** using the published state rate. Rare and usually
not worth the effort for <$20 orders.

## Status reference

### Order statuses

| `status` | Meaning |
|---|---|
| `pending` | Order placed; default for every new order |
| `completed` | Fully fulfilled + paid; no open returns |
| `canceled` | Explicitly canceled (customer or ops) |
| `requires_action` | Payment or fulfillment flagged an issue |
| `archived` | Cold-storage — not commonly used |

### Payment statuses

| `payment_status` | Meaning | Next action |
|---|---|---|
| `not_paid` | No payment attempted | Shouldn't happen post-checkout |
| `awaiting` | Payment session created but not completed | Customer didn't finish |
| `authorized` | FluidPay authorized, not captured | Capture at fulfillment |
| `captured` | Money moved from customer to us | Fulfill + ship |
| `partially_refunded` | Partial refund issued | — |
| `refunded` | Full refund issued | — |
| `canceled` | Void issued before capture | — |

### Fulfillment statuses

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

### Purchase order statuses

| `status` | Meaning |
|---|---|
| `open` | Created, awaiting receipt of goods (or partially received) |
| `partial` | Some lines received, others outstanding |
| `closed` | Every line fully received |
| `canceled` | Manually canceled before any receipts |
