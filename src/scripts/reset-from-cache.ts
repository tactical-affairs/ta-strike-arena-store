/**
 * Phase 1 of `npm run reset`. Run as a plain Node script via ts-node.
 * Does the network-free shell + SQL + filesystem work, then spawns the CLI
 * commands that need Medusa's container (admin user creation + publishable
 * key + procurement bootstrap).
 *
 * Steps:
 *   1. Validate cache exists and is readable.
 *   2. Drop + recreate the dev Postgres DB (via docker exec).
 *   3. pg_restore .cache/catalog.dump into the empty DB.
 *   4. Run `npx medusa db:migrate` to bring schema to local code's HEAD.
 *      This handles the case where local code has migrations newer than
 *      the prod snapshot — prod-newer-than-local would have already
 *      failed at restore.
 *   5. Defense-in-depth scrub: TRUNCATE every transactional table pattern.
 *   6. Reset inventory levels to DEV_DEFAULT_STOCK.
 *   7. Mirror .cache/images/ into ./static/ and rewrite image URLs in DB
 *      from prod's R2 prefix to http://localhost:9000/static/.
 *   8. Create dev admin user via `npx medusa user`.
 *   9. Run `npx medusa exec ./src/scripts/reset-finalize.ts` to inject the
 *      stable publishable key and re-bootstrap procurement.
 *
 * Requires (env vars, all loaded from .env automatically by this project):
 *   POSTGRES_CONTAINER     — Docker container name (default: ta-strike-arena-postgres)
 *   POSTGRES_USER          — DB user (default: medusa)
 *   DB_NAME                — DB name (default: ta_strike_arena)
 *   DEV_DEFAULT_STOCK      — fixed stocked_quantity per inventory level (default: 100)
 *   DEV_ADMIN_EMAIL        — admin login email (default: admin@tacticalaffairs.com)
 *   DEV_ADMIN_PASSWORD     — admin password (default: testing)
 *   DEV_PUBLISHABLE_KEY    — pk_… token to inject in reset-finalize.ts
 */

/* eslint-disable no-console */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { TRANSACTIONAL_TABLE_PATTERNS } from "./lib/transactional-tables";

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CACHE_DIR = path.join(PROJECT_ROOT, ".cache");
const CACHE_DUMP = path.join(CACHE_DIR, "catalog.dump");
const CACHE_IMAGES = path.join(CACHE_DIR, "images");
const CACHE_MANIFEST = path.join(CACHE_DIR, "manifest.json");
const STATIC_DIR = path.join(PROJECT_ROOT, "static");

type CacheManifest = {
  pulledAt: string;
  prodMigrationCount: number;
  /**
   * Major version of the prod Postgres server at pull time. We must use a
   * matching `postgres:<major>` Docker image for pg_restore — the dump's
   * custom-format header is tagged with the pg_dump version, and a
   * mismatched pg_restore (e.g. local v16 against a v18 dump) rejects with
   * "unsupported version (1.16) in file header".
   *
   * Optional for backwards compat with caches pulled before this field was
   * added; falls back to a sensible default.
   */
  prodPostgresMajorVersion?: string;
  r2PublicBase: string;
  bucket: string;
  images: Array<{ key: string; etag: string; size: number }>;
};

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var: ${name}`);
}

function run(cmd: string, args: string[], opts: { stdin?: string; allowFail?: boolean } = {}) {
  const result = spawnSync(cmd, args, {
    stdio: opts.stdin ? ["pipe", "inherit", "inherit"] : "inherit",
    input: opts.stdin,
    cwd: PROJECT_ROOT,
    env: process.env,
  });
  if (result.status !== 0 && !opts.allowFail) {
    throw new Error(
      `Command failed (${result.status}): ${cmd} ${args.join(" ")}`,
    );
  }
  return result;
}

function dockerPsql(sql: string, opts: { db?: string } = {}) {
  const container = env("POSTGRES_CONTAINER", "ta-strike-arena-postgres");
  const user = env("POSTGRES_USER", "medusa");
  const db = opts.db ?? "postgres";
  return run(
    "docker",
    ["exec", "-i", container, "psql", "-U", user, "-d", db, "-v", "ON_ERROR_STOP=1"],
    { stdin: sql },
  );
}

function loadEnvFile(filePath: string) {
  // Tiny .env loader (no dotenv dep). Doesn't handle multi-line values
  // or escaped quotes — keep `.env` simple.
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

async function main() {
  loadEnvFile(path.join(PROJECT_ROOT, ".env"));

  // ── Step 0: production safety guard ───────────────────────
  // This script drops + recreates the dev DB and runs `medusa db:migrate`,
  // which uses DATABASE_URL from env. If that points anywhere remote,
  // refuse to continue. Local Docker setups use localhost or the
  // container name; everything else is a hard stop.
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (dbUrl) {
    const isLocal =
      /(?:^|@)(?:localhost|127\.0\.0\.1|::1|host\.docker\.internal|ta-strike-arena-postgres)\b/.test(
        dbUrl,
      );
    if (!isLocal) {
      throw new Error(
        `Refusing to reset: DATABASE_URL points at a non-local host (${dbUrl.replace(/:[^:@]+@/, ":***@")}). ` +
          `Unset DATABASE_URL or point it at localhost/the local Docker container before running \`npm run reset\`.`,
      );
    }
  }

  // ── Step 1: validate cache ────────────────────────────────
  if (!fs.existsSync(CACHE_DUMP)) {
    throw new Error(
      `Missing ${CACHE_DUMP}. Run \`npm run pull:prod\` first.`,
    );
  }
  if (!fs.existsSync(CACHE_MANIFEST)) {
    throw new Error(
      `Missing ${CACHE_MANIFEST}. Run \`npm run pull:prod\` first.`,
    );
  }
  const manifest: CacheManifest = JSON.parse(fs.readFileSync(CACHE_MANIFEST, "utf8"));
  console.log(`[reset] Using cache pulled at ${manifest.pulledAt}`);
  console.log(`[reset] Prod R2 base: ${manifest.r2PublicBase}`);
  console.log(`[reset] Prod migration count: ${manifest.prodMigrationCount}`);

  const dbName = env("DB_NAME", "ta_strike_arena");
  const user = env("POSTGRES_USER", "medusa");
  const container = env("POSTGRES_CONTAINER", "ta-strike-arena-postgres");

  // ── Step 2: drop + recreate DB ────────────────────────────
  console.log(`[reset] Dropping + recreating DB ${dbName}.`);
  dockerPsql(`
    SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
     WHERE datname = '${dbName}' AND pid <> pg_backend_pid();
    DROP DATABASE IF EXISTS ${dbName};
    CREATE DATABASE ${dbName} OWNER ${user};
  `);

  // ── Step 3: pg_restore ────────────────────────────────────
  // Use a matching `postgres:<major>` ephemeral container so pg_restore's
  // custom-format parser accepts the dump. The local container may be on
  // a different major than prod (e.g. local v16, prod v18 — pg_restore v16
  // rejects v18 dumps with "unsupported version 1.16 in file header").
  // The ephemeral container connects to the local Postgres via
  // host.docker.internal so it can write to the just-recreated dev DB.
  const restoreMajor = manifest.prodPostgresMajorVersion ?? "18";
  const restoreImage = `postgres:${restoreMajor}`;
  console.log(`[reset] Restoring catalog dump via ephemeral ${restoreImage} container.`);
  // Make sure the image exists; first run after a prod major bump pulls it.
  spawnSync("docker", ["pull", "-q", restoreImage], { stdio: "inherit", cwd: PROJECT_ROOT });

  const dumpBuffer = fs.readFileSync(CACHE_DUMP);
  // host.docker.internal resolves to the Docker host on Docker Desktop (Mac/Win).
  // Local Postgres is published on host port 5433 → container port 5432.
  const restoreUrl = `postgresql://${user}:${user}@host.docker.internal:5433/${dbName}`;
  const restore = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "-i",
      restoreImage,
      "pg_restore",
      "-d",
      restoreUrl,
      "--no-owner",
      "--no-privileges",
    ],
    { input: dumpBuffer, stdio: ["pipe", "inherit", "inherit"], cwd: PROJECT_ROOT },
  );
  if (restore.status !== 0) {
    // pg_restore often returns non-zero on benign warnings (e.g. role
    // ownership). Run a sanity check via the local container's psql:
    // does the product table have rows? If yes, treat the warnings as benign.
    const check = spawnSync(
      "docker",
      ["exec", container, "psql", "-U", user, "-d", dbName, "-tAc",
        "SELECT count(*) FROM product"],
      { encoding: "utf8" },
    );
    const productCount = parseInt(check.stdout?.trim() ?? "0", 10);
    if (!Number.isFinite(productCount) || productCount === 0) {
      throw new Error("pg_restore left an empty product table — restore failed.");
    }
    console.warn(
      `[reset] pg_restore exited with warnings (status=${restore.status}); product table has ${productCount} rows, continuing.`,
    );
  }

  // ── Step 4: bring schema to local HEAD ────────────────────
  console.log(`[reset] Running medusa db:migrate to normalize schema.`);
  run("npx", ["medusa", "db:migrate"]);

  // ── Step 5: defense-in-depth scrub ────────────────────────
  // The pull dump excluded data for these patterns, but if a Medusa
  // upgrade adds a transactional table we haven't yet listed, this
  // catches any rows that came along.
  console.log(`[reset] Truncating transactional tables.`);
  const truncateSql = TRANSACTIONAL_TABLE_PATTERNS
    .map((pattern) => {
      // Convert glob (foo*) to SQL LIKE and TRUNCATE each match.
      // Wrap in DO block so a missing table doesn't abort the batch.
      return `
        DO $$ DECLARE r record;
        BEGIN
          FOR r IN SELECT tablename FROM pg_tables
                    WHERE schemaname = 'public'
                      AND tablename LIKE '${pattern.replace(/\*/g, "%")}'
          LOOP
            EXECUTE format('TRUNCATE TABLE %I RESTART IDENTITY CASCADE', r.tablename);
          END LOOP;
        END $$;
      `;
    })
    .join("\n");
  dockerPsql(truncateSql, { db: dbName });

  // ── Step 6: reset inventory levels ────────────────────────
  const devStock = parseInt(env("DEV_DEFAULT_STOCK", "100"), 10);
  console.log(`[reset] Setting all inventory_level rows to stocked_quantity=${devStock}.`);
  dockerPsql(
    `UPDATE inventory_level
        SET stocked_quantity = ${devStock},
            reserved_quantity = 0,
            incoming_quantity = 0;`,
    { db: dbName },
  );

  // ── Step 7: mirror images + rewrite URLs ──────────────────
  console.log(`[reset] Mirroring .cache/images/ → ./static/.`);
  if (fs.existsSync(STATIC_DIR)) {
    fs.rmSync(STATIC_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(STATIC_DIR, { recursive: true });
  if (fs.existsSync(CACHE_IMAGES)) {
    let copied = 0;
    for (const file of fs.readdirSync(CACHE_IMAGES)) {
      fs.copyFileSync(path.join(CACHE_IMAGES, file), path.join(STATIC_DIR, file));
      copied++;
    }
    console.log(`[reset] Copied ${copied} images to ./static/.`);
  } else {
    console.warn(
      `[reset] No .cache/images/ directory — skipping image mirror. URLs in DB will still point at prod R2.`,
    );
  }

  const r2Base = manifest.r2PublicBase.replace(/\/+$/, "");
  console.log(`[reset] Rewriting image URLs from ${r2Base} → http://localhost:9000/static.`);
  // The `image` table holds `url` directly. Use string replace: each prod
  // URL is `${r2Base}/<flat-name>`; replacing the prefix yields
  // `http://localhost:9000/static/<flat-name>` which the local file
  // provider serves out of ./static/.
  dockerPsql(
    `UPDATE image SET url = REPLACE(url, '${r2Base}', 'http://localhost:9000/static');`,
    { db: dbName },
  );

  // ── Step 8: create dev admin user ─────────────────────────
  const devEmail = env("DEV_ADMIN_EMAIL", "admin@tacticalaffairs.com");
  const devPass = env("DEV_ADMIN_PASSWORD", "testing");
  console.log(`[reset] Creating dev admin user ${devEmail}.`);
  run("npx", ["medusa", "user", "-e", devEmail, "-p", devPass]);

  // ── Step 9: finalize via medusa exec ──────────────────────
  console.log(`[reset] Running reset-finalize.ts (publishable key + procurement).`);
  run("npx", ["medusa", "exec", "./src/scripts/reset-finalize.ts"]);

  console.log(`[reset] ✓ Done. Run \`npm run dev\` (or restart it) to pick up the fresh DB.`);
}

main().catch((err) => {
  console.error("[reset] FAILED:", err);
  process.exit(1);
});
