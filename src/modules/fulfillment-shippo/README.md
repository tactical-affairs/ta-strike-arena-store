# Shippo fulfillment provider

Live multi-carrier shipping rates, label purchase, and returns via
[Shippo](https://goshippo.com/).

## How it fits into Medusa

Registered in `medusa-config.ts` under the fulfillment module. When the
env var `SHIPPO_API_KEY` is set, this provider is added alongside
`@medusajs/medusa/fulfillment-manual`. When it's unset, only the manual
provider loads and the seed falls back to flat-rate options.

## Supported shipping options

One fulfillment option per carrier + service level, referenced by `id` in
each shipping option's `data`:

| id | Carrier | Service |
|---|---|---|
| `usps__ground_advantage` | USPS | Ground Advantage |
| `usps__priority` | USPS | Priority Mail |
| `ups__ground` | UPS | Ground |
| `ups__2nd_day_air` | UPS | 2nd Day Air |
| `fedex__ground` | FedEx | Ground |
| `fedex__2day` | FedEx | 2Day |

All six options are seeded as `price_type: "calculated"`; rates are pulled
live from Shippo's `/shipments/` endpoint per cart.

## Bundle handling

Bundle SKUs ship as **a single box**. At seed time, each bundle's
variant gets `weight = sum of component weights × required_quantity`
and box dims = max of each component dim. Example: Pro Plus Package
(5× Pro Target + 1× Training Console) → weight in oz = 5× Pro Target
weight + 1× Console weight; box L/W/H = the biggest L/W/H seen across
the components. That gives us one parcel quote per bundle cart line.

The provider reads `weight/length/width/height` directly off each cart
item's nested `variant` — it does not need cross-module query access
to expand bundles at rate-calc time.

## Parcel packing

See [`packer.ts`](./packer.ts). First-Fit Decreasing by weight across a
small set of box templates (SM / MD / LG / XL / RIFLE), all sized under
the strictest carrier limits (USPS 70 lb, 130" length+girth).

Packing at rate-calc time is an estimate. Admins can override parcels at
label-purchase time by re-creating the fulfillment with custom dims.

## Rate caching

`calculatePrice` caches the Shippo shipment response for 5 minutes,
keyed by `cart_id + items + shipping address`. Benefits:

- Medusa invokes `calculatePrice` once per enabled shipping option
  (6x per cart refresh) — one cached shipment serves all six lookups.
- Sandbox responses are non-deterministic; caching stabilises the
  quote between the storefront's `/calculate` call and Medusa's
  re-invocation during `addShippingMethod`.

Only non-empty responses are cached (so a partial sandbox response
doesn't poison subsequent lookups). `createFulfillment` always hits
Shippo fresh since rate IDs expire.

## Env vars

```
SHIPPO_API_KEY=shippo_test_...        # sandbox or shippo_live_... for prod
SHIPPO_FROM_NAME="Strike Arena Warehouse"
SHIPPO_FROM_STREET1="123 Main St"
SHIPPO_FROM_STREET2=""                # optional
SHIPPO_FROM_CITY=Redmond
SHIPPO_FROM_STATE=WA
SHIPPO_FROM_ZIP=98052
SHIPPO_FROM_PHONE="+15555550123"
[email protected]
SHIPPO_WEBHOOK_SECRET=...              # set after creating webhook in Shippo dashboard
```

Production requires a `shippo_live_...` key and at least one live carrier
account connected in the Shippo dashboard. Sandbox keys get Shippo's test
carriers by default — enough to validate the full flow end-to-end.

## Webhook

Shippo posts tracking status changes to `POST {BACKEND_URL}/hooks/shippo`
(see `src/api/hooks/shippo/route.ts`). Signature verification uses
HMAC-SHA256 over the raw body with `SHIPPO_WEBHOOK_SECRET`.

**Production setup** (after the backend is deployed):

1. In Shippo dashboard, toggle to **Live** mode (top bar). Test-mode
   webhooks don't fire for real shipments.
2. Settings → Webhooks → **Add webhook**
   - URL: `https://<backend-domain>/hooks/shippo`
   - Event types: `track_updated`, `transaction_updated`
   - Mode: Live
3. Copy the signing secret shown on save (one-time display) into the
   backend's `SHIPPO_WEBHOOK_SECRET` env var and redeploy.
4. Click **"Send test"** on the webhook to verify. Railway logs should
   show `[shippo-webhook] received ...`. A 401 means the secret didn't
   match — check for trailing whitespace.

**Dev note**: Shippo can't POST to `localhost`. If you want to test the
webhook path locally, tunnel via ngrok / cloudflared and point Shippo
at the tunnel URL. Not required for validating rate-calc or label
purchase.

**If the secret is missing or wrong**:

- Missing → route logs a warning and accepts any caller. Acceptable
  in dev; never in prod (any attacker with the URL could spoof
  tracking updates).
- Wrong → incoming webhooks 401. Orders still ship and labels still
  print, but fulfillment status won't auto-advance on delivery.

## Testing with sandbox

1. Sign up at [apps.goshippo.com](https://apps.goshippo.com/signup)
2. Copy the "Test Token" from API → Tokens
3. Set `SHIPPO_API_KEY=shippo_test_...` in `.env`
4. Restart `npm run dev`
5. Reseed — shipping options will be calculated instead of flat
6. Add products to cart on the storefront, check out to any real US
   address. Rates appear live from Shippo's sandbox carriers.
