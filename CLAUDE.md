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

Claude Code is configured with `additionalDirectories` in `.claude/settings.local.json` so it can read and edit both projects in the same session.

## Claude Code Setup

This project uses Medusa agent skills for Claude Code (configured in `.claude/settings.json`). New developers need to register the marketplace once (this is a global, one-time setup):

```
/plugin marketplace add medusajs/medusa-agent-skills
```

After that, the project's `enabledPlugins` in `.claude/settings.json` will automatically activate the Medusa skills (modules, API routes, workflows, storefronts, admin customizations).
