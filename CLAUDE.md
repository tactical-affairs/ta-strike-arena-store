# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Medusa.js v2** headless ecommerce backend for the Strike Arena brand. It serves as the commerce API layer (product catalog, orders, fulfillment, regions, inventory) and includes an extensible admin dashboard.

- Database: PostgreSQL (`ta_strike_arena` database)
- Cache: Redis
- Node: >=20 required
- Port: 9000 (API + Admin in production), 5173 (Admin dev via Vite)

## Commands

```bash
npm run dev          # Dev server with hot reload (medusa develop)
npm run build        # Compile TypeScript → .medusa/server
npm run start        # Production server
npm run seed         # Initialize demo data (products, regions, shipping)

npm run test:unit                    # Unit tests (src/**/__tests__/**/*.unit.spec.ts)
npm run test:integration:http        # HTTP integration tests (integration-tests/http/)
npm run test:integration:modules     # Module integration tests
```

## Architecture

### Extension Points (src/)

Medusa v2 uses an **isolated module + container injection** pattern. All customization lives in `src/`:

- **`api/`** — Custom HTTP routes. `admin/custom/` and `store/custom/` have boilerplate; add route handlers here.
- **`modules/`** — Custom isolated modules with their own data models and services. Each module registers into the Medusa container.
- **`workflows/`** — Multi-step business logic orchestrations. Steps are independently retryable with compensation (rollback) support. Used for complex operations like order processing.
- **`subscribers/`** — Event-driven handlers that react to domain events (e.g., `product.created`, `order.placed`).
- **`jobs/`** — Cron-scheduled background tasks.
- **`links/`** — Cross-module relationships without tight coupling.
- **`admin/`** — React components (widgets) injected into the admin UI. Has a separate `tsconfig.json` targeting ES2020 for React.
- **`scripts/seed.ts`** — Seeds demo data: 1 region (Europe, 7 countries), 4 product categories, 4 products with variants, fulfillment sets, and stock location (Copenhagen).

### Request Flow

```
HTTP Request → src/api/*/route.ts
  → Resolve services from Medusa Container
  → Execute Workflows or direct service calls
  → Emit domain events → Subscribers react
```

### Configuration

`medusa-config.ts` is the main config file. Key environment variables (see `.env.template`):

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | PostgreSQL connection |
| `REDIS_URL` | Redis cache |
| `STORE_CORS` | Allowed store frontend origins |
| `ADMIN_CORS` | Allowed admin frontend origins |
| `AUTH_CORS` | Allowed auth endpoint origins |
| `JWT_SECRET` / `COOKIE_SECRET` | Token/cookie signing |
| `S3_*` (six vars) | Cloudflare R2 / S3 file storage; all six required for prod |

### File storage

`medusa-config.ts` conditionally registers a File Module provider:

- **`S3_ACCESS_KEY_ID` unset (dev)** → `@medusajs/medusa/file-local`, writes uploads to `./static/` (gitignored). Files served publicly at `http://localhost:9000/static/<filename>`.
- **`S3_ACCESS_KEY_ID` set (prod)** → `@medusajs/medusa/file-s3`, uploads to the R2 bucket specified in `S3_BUCKET`. Used for Admin UI uploads and the seed script's product images.

The seed script (`src/scripts/seed.ts`) reads product images from the sibling repo at `../ta-strike-arena-website/public/images/` and uploads each file through the File Module so `product.images[].url` points at wherever the provider stored it. Image filenames are flattened (e.g. `strike-arena-target__front.png`) to avoid collisions across product folders. All uploads use `access: "public"`.

### Inventory kits / bundles

Seven SKUs are bundles composed of other products, using Medusa v2's native **Inventory Kits** feature — a bundle variant doesn't own a fresh inventory_item; instead its `inventory_items` array references the component variants' inventory_items with a `required_quantity`. Medusa then computes the bundle's availability as `min(component_available / required_quantity)` and decrements each component's stock when the bundle sells.

Bundle → component mapping lives declaratively on the `SeedProduct` type in `src/scripts/seed.ts` via the optional `components` field. Presence of `components` makes a product a bundle; non-bundle products declare `stockQuantity` instead. The seed runs in two passes — non-bundles first (so their inventory_items exist), then bundles referencing those inventory_items via a SKU-keyed lookup.

Current bundle catalog:

| Bundle SKU | Components |
|---|---|
| SA.004.01 Home Starter Package | 3× SA.003.01 |
| SA.008.01 Home Premium Package | 5× SA.003.01 |
| SA.005.01 Pro Plus Package | 5× SA.001.01 + 1× SA.002.01 |
| SA.006.01 Pro Premium Package | 10× SA.001.01 + 1× SA.002.01 |
| SA.100.01 Starter Handgun Kit (Sig) | 1× 101-00271 + 1× SPDRKIT-IR |
| SA.101.01 Starter Handgun Kit (Glock) | 1× 101-00244 + 1× SPDRKIT-IR |
| SA.102.01 Starter Rifle Kit (AR-15) | 1× 106-01410-ETU + 1× FLASHKIT-IR |

To add a new bundle: append a `SeedProduct` entry with `components: [{ sku, quantity }, ...]` and no `stockQuantity`. To add a new non-bundle: append with `stockQuantity: N` and no `components`. The two-pass seed handles the rest. See Medusa's [Inventory Kits docs](https://docs.medusajs.com/resources/commerce-modules/inventory/inventory-kit) for the underlying concepts.

### Payment providers

`medusa-config.ts` registers the Payment Module conditionally, based on env vars:

- **FluidPay** — custom provider in `src/modules/payment-fluidpay/`. Registered **only when `FLUIDPAY_API_KEY` is set**. Token-based flow: storefront uses the FluidPay Tokenizer iframe (with the public key) to exchange card data for a `tok_...`, storefront updates the Medusa payment session with that token, `authorizePayment()` posts to `/api/transaction` with the secret key. See `src/modules/payment-fluidpay/README.md` for the full method-by-method status and remaining TODOs (webhooks, status mapping verification, storefront wiring).
- **Authorize.net** — handled outside Medusa for now. The storefront at `ta-strike-arena-website/src/app/checkout/` uses Accept.js directly. No Medusa provider module is registered. Once FluidPay takes over, this path can be removed.

Provider activation env vars (see `.env.template`):

| Variable | Purpose |
|----------|---------|
| `FLUIDPAY_API_KEY` | Secret key (`api_...`) — server-side only; presence toggles the module on |
| `FLUIDPAY_PUBLIC_KEY` | Public key (`pub_...`) — passed through to the storefront via the payment session's `data.publicKey` |
| `FLUIDPAY_BASE_URL` | `https://sandbox.fluidpay.com` (dev) or `https://app.fluidpay.com` (prod) |
| `FLUIDPAY_CAPTURE_MODE` | `authorize` (default; capture later from admin) or `sale` (capture immediately) |

**Dev activation**: add `FLUIDPAY_*` vars to `.env` pointing at FluidPay sandbox. Restart Medusa. In the Admin UI → Settings → Regions, enable the `pp_fluidpay_fluidpay` provider for the relevant region.

**Prod activation**: add the same vars on Railway (with the prod FluidPay keys and `FLUIDPAY_BASE_URL=https://app.fluidpay.com`). Redeploy. Enable the provider in the prod region. Remove Authorize.net configuration from the storefront checkout flow as part of the switchover.

### Shipping / fulfillment

`medusa-config.ts` registers the Fulfillment Module with two providers:

- **manual_manual** (`@medusajs/medusa/fulfillment-manual`) — always on, used as a fallback when Shippo credentials aren't set.
- **shippo_shippo** — custom provider in `src/modules/fulfillment-shippo/`. Registered **only when `SHIPPO_API_KEY` is set**. See the module's [README](src/modules/fulfillment-shippo/README.md) for supported carriers, parcel templates, and sandbox-testing steps.

When `SHIPPO_API_KEY` is unset, `seed.ts` creates the original two flat-rate options (Standard $10 / Express $25). When set, it seeds six calculated options mapped to Shippo carrier/service pairs (USPS Ground Advantage, USPS Priority, UPS Ground, UPS 2nd Day, FedEx Ground, FedEx 2Day).

**Bundle handling**: Bundle SKUs ship as a single box whose weight is the sum of component weights and whose dimensions are sized to fit the largest component. Example: Pro Plus Package (5× Pro Target + 1× Training Console) gets `weight = 5 × pro_target.weight + 1 × console.weight`, box dims = max of all component dims. Computed in `seed.ts` at seed time and written onto the bundle variant's `weight/length/width/height` fields. The provider reads those fields directly off each cart line item's nested `variant` — no cross-module queries needed. Tradeoff: one bundle purchase = one parcel quote, not N component parcel quotes. If you need to ship bundle components separately (e.g. you run out of shelf space for preassembled bundles), revert to the component-expansion model described in git history for commit `a2c1635`.

**Parcel packing**: First-Fit Decreasing by weight against five box templates (SM 5lb, MD 20lb, LG 40lb, XL 60lb, RIFLE 15lb long-and-narrow). All templates fit under USPS's 70 lb / 130" length+girth limits, so any packed parcel is shippable by every supported carrier. See `src/modules/fulfillment-shippo/packer.ts`.

**Parcel dims**: Seed populates every non-bundle product with placeholder `parcel: { weightOz, lengthIn, widthIn, heightIn }` values — search for `// TODO: measure actual packaging` in `src/scripts/seed.ts`. **Replace these with real measurements before the production seed.** Wrong dims → wrong rates → carrier rejection at pickup or dim-weight surcharges in the weekly invoice.

**Rate caching**: `calculatePrice` caches each successful Shippo shipment response for 5 minutes keyed by `cart_id + items + shipping address`. Purpose is twofold: (1) Medusa invokes `calculatePrice` once per enabled shipping option (6x per cart refresh), so one Shippo call serves all six lookups; (2) Shippo's sandbox occasionally returns partial / empty rate arrays, and the cache stabilises the quote between the storefront's `/calculate` call and Medusa's re-invocation during `addShippingMethod`. Label-purchase (`createFulfillment`) always hits Shippo fresh since rate IDs expire.

**Webhook**: `POST /hooks/shippo` receives tracking updates. Signature verified via HMAC-SHA256 over the raw body using `SHIPPO_WEBHOOK_SECRET`. Events are emitted on the internal event bus as `shippo.{event}`.

Provider activation env vars (see `.env.template` for the full list):

| Variable | Purpose |
|----------|---------|
| `SHIPPO_API_KEY` | Test (`shippo_test_...`) or live (`shippo_live_...`) token — presence toggles the module on |
| `SHIPPO_FROM_*` | Warehouse origin address (name, street1/2, city, state, zip, country, phone, email) — printed on labels and sent to carriers for rate quotes |
| `SHIPPO_WEBHOOK_SECRET` | HMAC signing secret from Shippo dashboard → Settings → Webhooks |

**Dev activation**: sign up at [apps.goshippo.com](https://apps.goshippo.com/signup), copy the "Test Token" from API → Tokens, set `SHIPPO_API_KEY=shippo_test_...` + `SHIPPO_FROM_*` in `.env`, restart Medusa, and reseed. Sandbox rates come from Shippo's test carriers — no real labels are purchased. **Caveat**: Shippo's sandbox is non-deterministic — consecutive calls for the same shipment occasionally return different carrier subsets (one call has USPS only, the next has UPS only, etc.). The provider's 5-minute shipment cache papers over this for any given cart, but during testing you'll see the rate rows flicker between carriers if you re-fetch. Not a bug, just sandbox behaviour.

**Prod activation**: set `SHIPPO_API_KEY=shippo_live_...` plus the production warehouse address on Railway. Connect live UPS/USPS/FedEx carrier accounts in the Shippo dashboard. Redeploy the backend, then redeploy the frontend so the prebuild sync picks up the new calculated options.

### Build Output

TypeScript compiles to `.medusa/server/` (git-ignored). The admin dashboard compiles to `.medusa/admin/`. Do not edit files in `.medusa/`.

### Testing Patterns

Tests use `@medusajs/test-utils`. Integration tests use `medusaIntegrationTestRunner`:

```typescript
medusaIntegrationTestRunner({
  inApp: true,
  testSuite: ({ api }) => {
    it("example", async () => {
      const response = await api.get('/health')
      expect(response.status).toEqual(200)
    })
  }
})
```

The `TEST_TYPE` env var controls which test suite Jest runs (set automatically by the npm scripts).

## Related Projects

This backend serves **ta-strike-arena-website** (Next.js storefront at `../ta-strike-arena-website/`). The storefront calls this backend's `/store/*` API endpoints via the Medusa JS SDK.

The storefront auto-generates `medusa-images.generated.ts` and `medusa-variants.ts` from this backend's `/store/products` response on every build (via its `scripts/sync-medusa-images.mjs` prebuild hook). Never hand-edit those files in the storefront repo.

Claude Code is configured with `additionalDirectories` in `.claude/settings.local.json` so it can read and edit both projects in the same session.

## Production Setup

First-time promotion from dev to production. Do these in order; each step depends on the previous one.

### 1. Provision infrastructure

- **Railway project** with this repo connected (auto-deploys on push to `main`). Includes managed Postgres + Redis plugins, or wire your own.
- **Cloudflare R2 bucket** (e.g. `ta-strike-arena-images`) with public access enabled and an API token scoped to Object Read + Write. Note the S3 endpoint (`https://<account-id>.r2.cloudflarestorage.com`) and public URL (`https://pub-<hash>.r2.dev` or a custom domain).
- **FluidPay merchant account** with production credentials (`pub_...` + `api_...`). Dashboard: https://app.fluidpay.com.
- **Shippo account** at https://apps.goshippo.com with a live API token (`shippo_live_...`) and at least one live carrier connected (USPS, UPS, FedEx). The live carriers must be fully activated in Shippo → Settings → Carriers, not just in test mode.

### 2. Railway env vars

Set all of these in the Railway service's Variables tab before first deploy. **Never commit production secrets to git.**

| Variable | Value | Why |
|---|---|---|
| `DATABASE_URL` | Postgres URL (from Railway Postgres plugin) | |
| `REDIS_URL` | Redis URL (from Railway Redis plugin) | |
| `JWT_SECRET` | strong random (≥32 bytes) | Never the default `supersecret` |
| `COOKIE_SECRET` | strong random (≥32 bytes, distinct from JWT) | Same |
| `STORE_CORS` | `https://strikearena.net` (no trailing slash) | Storefront origin |
| `ADMIN_CORS` | Railway backend URL | Admin UI origin |
| `AUTH_CORS` | both of the above, comma-separated | Auth endpoint origins |
| `S3_FILE_URL` | R2 public URL | File provider switches from local to R2 when set |
| `S3_ACCESS_KEY_ID` | R2 API token Access Key ID | |
| `S3_SECRET_ACCESS_KEY` | R2 API token Secret Access Key | |
| `S3_REGION` | `auto` | |
| `S3_BUCKET` | `ta-strike-arena-images` | |
| `S3_ENDPOINT` | R2 S3-compat endpoint URL | |
| `FLUIDPAY_API_KEY` | production `api_...` secret key | Payment provider registers only when this is set |
| `FLUIDPAY_PUBLIC_KEY` | production `pub_...` public key | Stored on payment sessions so the storefront can render the Tokenizer |
| `FLUIDPAY_BASE_URL` | `https://app.fluidpay.com` | Must be the prod host, **not** sandbox |
| `FLUIDPAY_CAPTURE_MODE` | `authorize` (default) or `sale` | `authorize` lets admins review before capturing |
| `SHIPPO_API_KEY` | production `shippo_live_...` token | Fulfillment provider registers only when this is set; live key swaps sandbox carriers for real USPS/UPS/FedEx |
| `SHIPPO_FROM_NAME` | e.g. `Strike Arena Warehouse` | Sender name printed on shipping labels |
| `SHIPPO_FROM_STREET1` | warehouse street address | Sent to carriers for rate quotes + printed on labels |
| `SHIPPO_FROM_STREET2` | apartment/suite (optional) | |
| `SHIPPO_FROM_CITY` / `SHIPPO_FROM_STATE` / `SHIPPO_FROM_ZIP` | warehouse city / 2-letter state / ZIP | USPS / UPS / FedEx will reject malformed values |
| `SHIPPO_FROM_COUNTRY` | `US` | Two-letter ISO country code |
| `SHIPPO_FROM_PHONE` | warehouse phone in E.164 | Required by some carriers for label acceptance |
| `SHIPPO_FROM_EMAIL` | warehouse contact email | Returned to carriers for delivery notifications |
| `SHIPPO_WEBHOOK_SECRET` | HMAC secret from Shippo dashboard | Verifies `POST /hooks/shippo` came from Shippo. Required in prod — see step 5 below |

### 3. Initial seed (run once, from local shell)

With the prod env loaded locally — either via `railway run -- <cmd>` or a throwaway `.env.production` file you delete afterward — run:

```bash
NODE_ENV=production npx medusa db:setup --db <prod-db-name>
NODE_ENV=production npm run seed
NODE_ENV=production npx medusa user -e <email> -p <strong-password>
```

Before seeding, replace the dev `stockQuantity` values in `src/scripts/seed.ts` with real starting inventory (search for `// TODO: replace with real prod starting inventory`). The seed uploads ~76 product images from `../ta-strike-arena-website/public/images/` to R2 and creates all 22 products (15 standalone + 7 bundles) in prod Postgres with R2 URLs.

### 4. Enable FluidPay on the region

With the backend deployed and reachable, authenticate as admin and attach the provider to the USA region (the seed creates only the `pp_system_default` attachment):

```bash
TOKEN=$(curl -s -X POST https://<railway-backend>/auth/user/emailpass \
  -H "Content-Type: application/json" \
  -d '{"email":"<admin-email>","password":"<admin-pass>"}' \
  | jq -r .token)
REGION_ID=$(curl -s -H "Authorization: Bearer $TOKEN" \
  https://<railway-backend>/admin/regions \
  | jq -r '.regions[0].id')
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  https://<railway-backend>/admin/regions/$REGION_ID \
  -d '{"payment_providers":["pp_fluidpay_fluidpay","pp_system_default"]}'
```

Or do it in the Admin UI: Settings → Regions → United States → add `pp_fluidpay_fluidpay`.

### 5. Register the Shippo webhook

The backend is deployed and has a public Railway URL. Now subscribe Shippo to send tracking updates to it.

1. Log into the Shippo dashboard at https://apps.goshippo.com and switch to **Live** mode (toggle in the top bar). Test-mode webhooks won't fire for real shipments.
2. Go to **Settings → Webhooks → Add webhook**.
3. Fill in:
   - **URL**: `https://<railway-backend>/hooks/shippo` (no trailing slash)
   - **Event types**: check `track_updated` and `transaction_updated`
   - **Mode**: `Live`
4. Save. Shippo displays the **signing secret** once — copy it immediately.
5. In Railway, set `SHIPPO_WEBHOOK_SECRET=<that-secret>` on the backend service. Redeploy so the new env var loads.
6. Back in Shippo, click the webhook's **"Send test"** button. Check Railway logs for a `[shippo-webhook] received ...` line; a 401 means the secret mismatched — double-check for trailing whitespace.

What happens if the webhook secret is missing or wrong:
- **Missing** (`SHIPPO_WEBHOOK_SECRET` unset): the route logs a warning and accepts any request. Fine for dev; never acceptable in prod — any attacker with the endpoint URL could spoof tracking updates.
- **Wrong**: incoming webhooks get 401'd. Orders still ship and labels still print, but Medusa won't auto-advance fulfillment status on delivery — ops would have to mark orders shipped manually.

Dev note: Shippo can't POST to `localhost`, so the webhook flow isn't exercised in local dev unless you expose the backend via ngrok / cloudflared. Not necessary for rate-calc or label-purchase testing.

### 6. Wire up the frontend

See [`ta-strike-arena-website/CLAUDE.md`](../ta-strike-arena-website/CLAUDE.md#production-setup-first-time). The storefront needs the new publishable API key, its own FluidPay public key, and a rebuild/redeploy so the prebuild sync picks up prod pricing + images + variant IDs. No Shippo env var is needed on the storefront side — the backend decides which shipping options exist.

### 7. Smoke test

Before announcing launch: place one real low-value order end-to-end against prod. Confirm the order appears in Admin → Orders with an authorized payment, the R2-hosted images load, the confirmation page shows an order ID, and the selected live carrier rate was applied (sanity-check against the rate returned by a direct Shippo dashboard quote for the same shipment). If capturing manually (`FLUIDPAY_CAPTURE_MODE=authorize`), also exercise the capture flow from the admin UI once.

Then fulfill that test order in the Admin UI → Orders → Create Fulfillment. A real label PDF appears on the fulfillment record. Confirm the Shippo dashboard shows the matching transaction and that the webhook delivers a `track_updated` event when the carrier picks up the package.

### Post-launch changes

After the initial seed, `seed.ts` becomes dev-only. Never run it against prod — duplicate handles would fail the workflow.

- **Content edits** (prices, descriptions, image swaps) → Medusa Admin UI. Uploads route to R2 automatically.
- **New products / structural changes** → write a one-off script in `src/scripts/` and run with `NODE_ENV=production medusa exec ./src/scripts/<name>.ts`. Commit the script.
- **Schema changes** → `medusa db:migrate` on deploy.

### Local dev: full reset

To reset local dev and reseed from scratch (ULID variant IDs will change, so the storefront will need `npm run sync-images` after):

```bash
docker exec ta-strike-arena-postgres psql -U medusa -d postgres \
  -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='ta_strike_arena' AND pid <> pg_backend_pid();" \
  -c "DROP DATABASE ta_strike_arena;"
rm -rf static
npx medusa db:setup --db ta_strike_arena
npm run seed
npx medusa user -e admin@example.com -p <password>
```

## Claude Code Setup

This project uses Medusa agent skills for Claude Code (configured in `.claude/settings.json`). New developers need to register the marketplace once (this is a global, one-time setup):

```
/plugin marketplace add medusajs/medusa-agent-skills
```

After that, the project's `enabledPlugins` in `.claude/settings.json` will automatically activate the Medusa skills (modules, API routes, workflows, storefronts, admin customizations).
