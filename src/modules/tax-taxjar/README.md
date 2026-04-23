# TaxJar tax provider

Live sales tax calculation and economic-nexus monitoring via
[TaxJar](https://www.taxjar.com/).

## How it fits into Medusa

Registered in `medusa-config.ts` under the tax module. When
`TAXJAR_API_KEY` is set the provider loads as `tp_taxjar` and seed
switches the US tax region to use it; otherwise Medusa's built-in
`tp_system` manual provider continues to load with zero rates
(current dev-without-credentials behavior).

## Checkout-time calculation

Medusa calls `getTaxLines(itemLines, shippingLines, context)` once per
cart refresh after the ship-to address is known. The provider:

1. Sums the item subtotal and shipping amount.
2. Builds a `/taxes` request to TaxJar with the from-address (warehouse
   origin, from `TAXJAR_FROM_*` or falling back to `SHIPPO_FROM_*`) and
   ship-to address pulled off the cart.
3. Parses the response:
   - Uses `breakdown.line_items[].combined_tax_rate` when TaxJar returns
     a per-item breakdown.
   - Falls back to `breakdown.combined_tax_rate` (or top-level `rate`)
     when it doesn't.
4. Emits an `ItemTaxLineDTO` per item and, when `freight_taxable` is
   true, one `ShippingTaxLineDTO` per shipping method.

If `has_nexus: false` or `amount_to_collect: 0` is returned, we emit
zero tax lines and the customer sees no sales tax — correct behavior
for states where we haven't registered.

## Failure handling

Tax-service errors never block checkout. On any TaxJar API failure the
provider logs the error and returns an empty tax-line array; the cart
simply shows no tax. Operations can reconcile manually once the service
comes back.

## Nexus configuration

Live tax collection happens only in states listed as nexus states in
the TaxJar dashboard (separate lists for sandbox and live accounts).
Add Washington first and enter your WA sales-tax permit number. Other
states are monitored via the Economic Nexus Insights dashboard — register
them there (and in the state's revenue department) before enabling
collection.

## Post-order sync

`src/subscribers/taxjar-order-sync.ts` listens for:

- `order.placed` → `POST /transactions/orders` so the order counts
  toward each state's economic-nexus threshold.
- `order.refund_created` → `POST /transactions/refunds` so collected
  tax is correctly reconciled on filings.

Sync failures are logged only, never rolled back; the order is still
authoritative for what the customer actually paid.

## Env vars

```
TAXJAR_API_KEY=               # sandbox (<test>) or live (<live>) token
TAXJAR_SANDBOX=true           # false in production
TAXJAR_FROM_ZIP=              # optional; default falls back to SHIPPO_FROM_ZIP
TAXJAR_FROM_STATE=            # optional; falls back to SHIPPO_FROM_STATE
TAXJAR_FROM_CITY=             # optional; falls back to SHIPPO_FROM_CITY
TAXJAR_FROM_STREET1=          # optional; falls back to SHIPPO_FROM_STREET1
```

## Sandbox caveats

- Sandbox is free; sign up at [app.taxjar.com](https://app.taxjar.com/).
  API → Tokens shows separate sandbox and live keys.
- Sandbox nexus regions are **separate** from live. Add WA as a sandbox
  nexus to see a non-zero `amount_to_collect` on test orders.
- Sandbox supports a limited fixture set for ship-to addresses
  (e.g. 98052 Redmond, 90002 LA, 90210 Beverly Hills). Real addresses
  generally work in sandbox too, but results can deviate slightly from
  live for obscure ZIPs.
- Sandbox responses may occasionally omit the per-line breakdown; the
  provider's fallback to `breakdown.combined_tax_rate` keeps totals
  consistent in that case.

## Testing end-to-end

1. Sign up at [app.taxjar.com](https://app.taxjar.com/signup).
2. Add **Washington** as a nexus state (State Settings → Add state).
3. Copy the sandbox token from API → Tokens.
4. Set `TAXJAR_API_KEY=<sandbox>` and `TAXJAR_SANDBOX=true` in `.env`.
5. Restart `npm run dev`; re-seed.
6. Add an item to the cart, check out to a WA address. The Payment
   step summary panel should show non-zero sales tax.
7. Place the order; within ~60s it appears in TaxJar sandbox
   Transactions → Orders.
