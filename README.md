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
- **PostgreSQL** — create the database:
  ```bash
  createdb ta_strike_arena
  ```
- **Redis** — run via Docker:
  ```bash
  docker run -d --name redis -p 6379:6379 --restart unless-stopped redis:7-alpine
  ```

## Development Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template and configure:

   ```bash
   cp .env.template .env
   ```

   Set at minimum:

   | Variable | Description |
   |----------|-------------|
   | `DATABASE_URL` | PostgreSQL connection string (e.g. `postgres://user:pass@localhost:5432/ta_strike_arena`) |
   | `REDIS_URL` | Redis connection string (default: `redis://localhost:6379`) |
   | `STORE_CORS` | Allowed storefront origins (include `http://localhost:8000` for local dev) |
   | `ADMIN_CORS` | Allowed admin dashboard origins |
   | `AUTH_CORS` | Allowed auth endpoint origins |
   | `JWT_SECRET` | Secret for signing auth tokens |
   | `COOKIE_SECRET` | Secret for signing cookies |

3. Run database migrations:

   ```bash
   npx medusa db:migrate
   ```

4. Create an admin user:

   ```bash
   npx medusa user -e admin@strikearena.net -p your-password
   ```

5. Seed demo data (regions, products, shipping, inventory):

   ```bash
   npm run seed
   ```

6. Start the dev server:

   ```bash
   npm run dev
   ```

   - **API**: http://localhost:9000
   - **Admin dashboard**: http://localhost:9000/app (or http://localhost:5173 in dev)

## Production

1. Build the project:

   ```bash
   npm run build
   ```

2. Start the production server:

   ```bash
   npm run start
   ```

In production, ensure `JWT_SECRET` and `COOKIE_SECRET` are set to strong, unique values (not the defaults). Update `STORE_CORS`, `ADMIN_CORS`, and `AUTH_CORS` to match your deployed domain origins.

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

The seed script (`src/scripts/seed.ts`) creates:

- **1 region**: Europe (GB, DE, DK, SE, FR, ES, IT) with EUR (default) + USD currencies
- **1 stock location**: European Warehouse (Copenhagen)
- **Shipping**: Standard (2-3 days) and Express (24 hours), flat rate
- **4 categories**: Shirts, Sweatshirts, Pants, Merch
- **4 products** with size variants (S/M/L/XL), published to the default sales channel
- **Publishable API key** linked to the default sales channel

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
