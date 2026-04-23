# Strike Arena Store

Headless ecommerce backend for the [Strike Arena](https://strikearena.net) brand, built on **Medusa.js v2**. Powers the product catalog, cart, checkout, orders, fulfillment, and inventory for the `ta-strike-arena-website` storefront.

## Architecture

```
ta-strike-arena-website (Next.js storefront)
        │
        │  @medusajs/js-sdk (client-side)
        ▼
ta-strike-arena-store (this project)
        │
        │  Medusa v2 modules
        ▼
   PostgreSQL + Redis
```

The storefront connects to this backend using the Medusa JS SDK with a publishable API key. All store API calls (cart, products, regions, checkout) go through Medusa's built-in `/store/*` endpoints. Custom endpoints live in `src/api/`.

## Prerequisites

- **Node.js** >= 20
- **Docker Desktop** — used to run PostgreSQL and Redis

## Development Setup

1. Start PostgreSQL and Redis:

   ```bash
   docker compose up -d
   ```

   This starts Postgres 16 on port **5433** (5432 is often taken) and Redis 7 on port 6379. Data persists across restarts via Docker volumes.

2. Install dependencies:

   ```bash
   npm install
   ```

3. Copy the environment template and configure:

   ```bash
   cp .env.template .env
   ```

   Set at minimum:

   | Variable | Description |
   |----------|-------------|
   | `DATABASE_URL` | PostgreSQL connection string (e.g. `postgres://medusa:medusa@localhost:5433/ta_strike_arena`) |
   | `REDIS_URL` | Redis connection string (default: `redis://localhost:6379`) |
   | `STORE_CORS` | Allowed storefront origins (include `http://localhost:8000` for local dev) |
   | `ADMIN_CORS` | Allowed admin dashboard origins |
   | `AUTH_CORS` | Allowed auth endpoint origins |
   | `JWT_SECRET` | Secret for signing auth tokens |
   | `COOKIE_SECRET` | Secret for signing cookies |

   Optional providers (unset → feature disabled):

   | Variable | Description |
   |----------|-------------|
   | `S3_ACCESS_KEY_ID` + five other `S3_*` vars | Switches file uploads from `./static/` (local) to Cloudflare R2 / S3. Required for production. |
   | `FLUIDPAY_API_KEY`, `FLUIDPAY_PUBLIC_KEY`, `FLUIDPAY_BASE_URL`, `FLUIDPAY_CAPTURE_MODE` | Enables the FluidPay payment provider. See `src/modules/payment-fluidpay/README.md`. |
   | `SHIPPO_API_KEY`, `SHIPPO_FROM_*`, `SHIPPO_WEBHOOK_SECRET` | Enables the Shippo fulfillment provider for live carrier rates, label purchase, and tracking webhooks. Unset → backend falls back to flat-rate shipping. See `src/modules/fulfillment-shippo/README.md`. |

4. Create the database and run migrations (first time only):

   ```bash
   npx medusa db:setup --db ta_strike_arena
   ```

5. Create an admin user:

   ```bash
   npx medusa user -e admin@strikearena.net -p your-password
   ```

6. Seed demo data (regions, products, shipping, inventory):

   ```bash
   npm run seed
   ```

7. Start the dev server:

   ```bash
   npm run dev
   ```

   - **API**: http://localhost:9000
   - **Admin dashboard**: http://localhost:9000/app (or http://localhost:5173 in dev)

## Production

Deployed to Railway. Full **first-time** promotion sequence (infrastructure, env vars, initial seed, admin user, FluidPay region attachment, smoke test) is in [`CLAUDE.md → Production Setup`](CLAUDE.md#production-setup) — that doc stays authoritative so this README doesn't duplicate moving details.

Quick checklist:

1. Build (`npm run build`) and start (`npm run start`) are the deploy commands; Railway runs both automatically.
2. Set `JWT_SECRET` and `COOKIE_SECRET` to strong, unique values — never the `supersecret` default.
3. Set `STORE_CORS`, `ADMIN_CORS`, `AUTH_CORS` to the production domains.
4. Set all six `S3_*` env vars to switch file uploads to Cloudflare R2.
5. Set all four `FLUIDPAY_*` vars — including `FLUIDPAY_BASE_URL=https://app.fluidpay.com` (NOT sandbox) and live `pub_.../api_...` credentials — to register the FluidPay payment provider.
6. Set `SHIPPO_API_KEY=shippo_live_...` plus `SHIPPO_FROM_*` (warehouse address) to register the Shippo fulfillment provider. See CLAUDE.md for the full variable list and the separate step to register the tracking webhook (post-deploy, in the Shippo dashboard → Settings → Webhooks; paste the returned signing secret into `SHIPPO_WEBHOOK_SECRET` and redeploy).
7. Replace dev `parcel` dims in `src/scripts/seed.ts` with real packaged weight + L×W×H before seeding — wrong dims cause carriers to reject shipments or charge "dimensional weight" penalties (look for `// TODO: measure actual packaging` markers).
8. Run `npx medusa db:setup` + `npm run seed` once (from a local shell with prod env loaded) to populate the catalog. Replace dev `stockQuantity` values first too (look for `// TODO: replace with real prod starting inventory`). After seeding, evolve the catalog via the Admin UI or one-off `medusa exec` scripts — **never** re-run `npm run seed` against prod.
9. Create an admin user (`npx medusa user ...`) and attach `pp_fluidpay_fluidpay` to the USA region via Admin UI or Admin API (see CLAUDE.md).
10. Hand the publishable API key and FluidPay public key off to the storefront's `.env.production` — see [`ta-strike-arena-website/README.md`](../ta-strike-arena-website/README.md#deploy-to-github-pages).

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Compile TypeScript to `.medusa/server/` |
| `npm run start` | Production server |
| `npm run seed` | Seed demo data (products, regions, shipping, fulfillment) |
| `npm run test:unit` | Unit tests (`src/**/__tests__/**/*.unit.spec.ts`) |
| `npm run test:integration:http` | HTTP integration tests (`integration-tests/http/`) |
| `npm run test:integration:modules` | Module integration tests |

## Connecting the Storefront

After starting this backend and running `npm run seed`, the storefront (`ta-strike-arena-website`) needs two environment variables:

- `NEXT_PUBLIC_MEDUSA_BACKEND_URL` — e.g. `http://localhost:9000`
- `NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY` — the publishable API key created by the seed script (find it in the admin dashboard under Settings > API Keys, or query the `/admin/api-keys` endpoint)

The storefront persists the cart ID in `localStorage` under key `sa_cart_id`.

## Seed Data

The seed script (`src/scripts/seed.ts`) creates the Strike Arena catalog:

- **1 region**: USA (USD)
- **1 stock location**
- **Shipping options**: Shippo calculated rates (USPS / UPS / FedEx) when `SHIPPO_API_KEY` is set; otherwise two flat options (Standard $10 / Express $25)
- **6 product categories**: Targets, Packages, Laser Attachments, Training Handguns, Training Rifles, Training Kits
- **22 products** — 15 standalone (targets, console, handguns, rifle, laser kits) and 7 **bundles** (Home/Pro target packages, Starter Handgun/Rifle Kits) that use Medusa's native [Inventory Kits](https://docs.medusajs.com/resources/commerce-modules/inventory/inventory-kit) feature. Bundle availability is automatically computed as `min(component_stock / required_quantity)`, and each component's stock is decremented when a bundle is sold. See `CLAUDE.md` for the bundle mapping table and how to add new ones.
- **Realistic per-SKU stock quantities** (e.g. 60 Home Targets, 30 Pro Targets, 15 Training Consoles, 8–15 of each training firearm) so bundle constraints are observable during testing
- **Product images** — reads from `../ta-strike-arena-website/public/images/` and uploads each file through the File Module. Lands in `./static/` with the local provider (dev) or Cloudflare R2 (when `S3_*` env vars are set)
- **Publishable API key** linked to the default sales channel

Images are flattened and namespaced (`strike-arena-target__front.png`) to avoid collisions across product folders, and uploaded with `access: "public"`.

## File storage

`medusa-config.ts` conditionally picks a file provider based on env:

- **`S3_ACCESS_KEY_ID` unset** → `@medusajs/medusa/file-local`, writes to `./static/` (gitignored). Files served at `http://localhost:9000/static/<filename>`.
- **`S3_ACCESS_KEY_ID` set** → `@medusajs/medusa/file-s3`. Production uses Cloudflare R2.

Set `S3_*` vars on Railway (prod) to swap providers — see `CLAUDE.md` for the full prod setup sequence.

## Payment providers

- **FluidPay** — custom module in `src/modules/payment-fluidpay/`. Registered only when `FLUIDPAY_API_KEY` is set. See the module's [README](src/modules/payment-fluidpay/README.md) for the integration checklist.
- **Authorize.net** — historically handled outside Medusa (Accept.js on the storefront). Being replaced by FluidPay.

## Fulfillment providers

- **manual_manual** — Medusa's built-in flat-rate provider. Always registered; acts as the fallback shipping option when Shippo credentials aren't configured.
- **shippo_shippo** — custom module in `src/modules/fulfillment-shippo/`. Registered only when `SHIPPO_API_KEY` is set. Handles live rates across USPS / UPS / FedEx, label purchase at fulfill time, returns, and tracking via `POST /hooks/shippo`. See the module's [README](src/modules/fulfillment-shippo/README.md) for the full list of supported carriers, box templates, and sandbox-testing steps.

## Tax providers

- **tp_system** — Medusa's built-in manual provider. Always registered as a fallback; with no rates configured (the default) it reports $0 tax on every cart.
- **tp_taxjar_taxjar** — custom module in `src/modules/tax-taxjar/`. Registered only when `TAXJAR_API_KEY` is set. Live sales-tax calc via TaxJar's `/taxes` endpoint and nexus-insights sync via `src/subscribers/taxjar-order-sync.ts`. Nexus states are configured in the TaxJar dashboard — phase 1 is WA-only. See the module's [README](src/modules/tax-taxjar/README.md) for sandbox setup.

## Project Structure

All customization goes in `src/`:

```
src/
├── api/           # Custom HTTP route handlers
├── admin/         # React widgets for the admin dashboard
├── modules/       # Isolated modules (own data models + services)
├── workflows/     # Multi-step orchestrations with rollback support
├── subscribers/   # Event-driven handlers (e.g. order.placed)
├── jobs/          # Cron-scheduled background tasks
├── links/         # Cross-module relationships
└── scripts/       # Utility scripts (seed.ts)
```

Build output goes to `.medusa/` (git-ignored). Do not edit files there.

## Resources

- [Medusa v2 Documentation](https://docs.medusajs.com)
- [Medusa Architecture Overview](https://docs.medusajs.com/learn/introduction/architecture)
- [Commerce Modules Reference](https://docs.medusajs.com/learn/fundamentals/modules/commerce-modules)
