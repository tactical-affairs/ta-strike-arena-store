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

First-time promotion from dev to production:

1. **Cloudflare R2**
   - Create a bucket (e.g. `ta-strike-arena-images`), enable public access.
   - Create an API token scoped to that bucket with Object Read + Write.
   - Note the S3 endpoint (`https://<account-id>.r2.cloudflarestorage.com`) and public URL (`https://pub-<hash>.r2.dev` or a custom domain).

2. **Railway env vars**

   | Variable | Value |
   |----------|-------|
   | `S3_FILE_URL` | R2 public URL (where images are served from) |
   | `S3_ACCESS_KEY_ID` | R2 API token Access Key ID |
   | `S3_SECRET_ACCESS_KEY` | R2 API token Secret Access Key |
   | `S3_REGION` | `auto` |
   | `S3_BUCKET` | `ta-strike-arena-images` |
   | `S3_ENDPOINT` | R2 endpoint URL |

3. **Initial seed (run once)**

   From a local shell with prod env vars exported (via `railway run` or a `.env.production` file):
   ```bash
   NODE_ENV=production npx medusa db:setup --db <prod-db-name>
   NODE_ENV=production npm run seed
   NODE_ENV=production npx medusa user -e <email> -p <password>
   ```

   The seed uploads all 70+ product images from `../ta-strike-arena-website/public/images/` to R2 and creates products in the prod Postgres with R2 URLs.

4. **Wire up the frontend** — see `ta-strike-arena-website/CLAUDE.md#production-setup-first-time`.

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
