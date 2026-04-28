/**
 * Refreshes `.cache/` with a fresh snapshot of the production catalog
 * (DB dump + R2 image mirror). Run as `npm run pull:prod`.
 *
 * Two parallel jobs:
 *   - `pg_dump` against prod's Postgres. Runs inside the local Postgres
 *     Docker container (so dev doesn't need libpq installed on the host),
 *     connecting over the public internet via DATABASE_PUBLIC_URL fetched
 *     from `railway variables --service Postgres`. Excludes data for every
 *     table pattern in lib/transactional-tables.ts; schema for those tables
 *     IS included so dev can run normally.
 *   - `ListObjectsV2` against prod's R2 bucket, ETag-diffed against the
 *     local manifest. New/changed objects download, removed objects are
 *     pruned locally, unchanged objects are skipped.
 *
 * Required env vars (in .env):
 *   PROD_R2_ACCESS_KEY_ID
 *   PROD_R2_SECRET_ACCESS_KEY
 *   PROD_R2_BUCKET
 *   PROD_R2_ENDPOINT             — e.g. https://<account>.r2.cloudflarestorage.com
 *   PROD_R2_PUBLIC_BASE          — e.g. https://pub-<hash>.r2.dev (used at reset
 *                                   time as the find-and-replace prefix for URLs)
 *   POSTGRES_CONTAINER           — local Docker container name (default: ta-strike-arena-postgres)
 *   RAILWAY_POSTGRES_SERVICE     — Railway service name for prod Postgres (default: Postgres)
 *
 * Production safety: this script never writes to prod. It only reads via
 * pg_dump (read query) and S3 GetObject/ListObjectsV2 (read API).
 */

/* eslint-disable no-console */
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  TRANSACTIONAL_TABLE_PATTERNS,
  pgDumpExcludeArgs,
} from "./lib/transactional-tables";

const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const CACHE_DIR = path.join(PROJECT_ROOT, ".cache");
const CACHE_DUMP = path.join(CACHE_DIR, "catalog.dump");
const CACHE_DUMP_TMP = path.join(CACHE_DIR, "catalog.dump.tmp");
const CACHE_IMAGES = path.join(CACHE_DIR, "images");
const CACHE_MANIFEST = path.join(CACHE_DIR, "manifest.json");

const DOWNLOAD_CONCURRENCY = 8;

type ImageEntry = { key: string; etag: string; size: number };

type CacheManifest = {
  pulledAt: string;
  prodMigrationCount: number;
  /**
   * Major version of the prod Postgres server at pull time. Reset uses this
   * to pick a matching `postgres:<major>` Docker image for pg_restore — the
   * dump's custom-format version is tied to the pg_dump version, and a
   * mismatched pg_restore will reject the file with "unsupported version".
   */
  prodPostgresMajorVersion: string;
  r2PublicBase: string;
  bucket: string;
  images: ImageEntry[];
};

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var: ${name}`);
}

function loadEnvFile(filePath: string) {
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

function loadManifest(): CacheManifest | null {
  if (!fs.existsSync(CACHE_MANIFEST)) return null;
  try {
    return JSON.parse(fs.readFileSync(CACHE_MANIFEST, "utf8")) as CacheManifest;
  } catch {
    return null;
  }
}

// ── Job 1: DB dump via local Postgres container ────────────────
//
// `pg_dump` isn't installed on most macOS hosts. Rather than make every
// developer `brew install libpq`, we run pg_dump from inside the local
// Postgres Docker container (which always has it bundled) and connect
// to prod's public URL over the internet. The container is already
// running because the user runs `medusa develop` against it.
//
// Railway exposes the Postgres service's public URL as
// DATABASE_PUBLIC_URL (separate from DATABASE_URL on the medusa service,
// which is the internal-only hostname). We fetch it once via
// `railway variables --service Postgres --kv`.

const POSTGRES_SERVICE_NAME = process.env.RAILWAY_POSTGRES_SERVICE ?? "Postgres";
const LOCAL_POSTGRES_CONTAINER = process.env.POSTGRES_CONTAINER ?? "ta-strike-arena-postgres";

function railwayKv(service: string): Record<string, string> {
  const result = spawnSync(
    "railway",
    ["variables", "--service", service, "--kv"],
    { encoding: "utf8", cwd: PROJECT_ROOT },
  );
  if (result.status !== 0) {
    throw new Error(
      `\`railway variables --service ${service}\` failed (status=${result.status}). ` +
        `Are you logged in (\`railway login\`) and linked to the right project (\`railway link\`)?`,
    );
  }
  const out: Record<string, string> = {};
  for (const line of (result.stdout ?? "").split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

async function dumpProdDb(): Promise<{ migrationCount: number; majorVersion: string }> {
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  console.log(`[pull] Fetching prod DB public URL from Railway service "${POSTGRES_SERVICE_NAME}" ...`);
  const vars = railwayKv(POSTGRES_SERVICE_NAME);
  const publicUrl = vars.DATABASE_PUBLIC_URL;
  if (!publicUrl) {
    throw new Error(
      `Could not find DATABASE_PUBLIC_URL on Railway service "${POSTGRES_SERVICE_NAME}". ` +
        `Set RAILWAY_POSTGRES_SERVICE if your Postgres service has a different name.`,
    );
  }
  // Append sslmode=require if not already set; Railway's proxy uses a
  // self-signed cert. `require` enforces encryption but doesn't validate the
  // chain (the libpq-compatible equivalent of "skip cert verification").
  // `verify-ca` / `verify-full` would fail on Railway's self-signed cert.
  const dumpUrl = publicUrl.includes("sslmode=") ? publicUrl : `${publicUrl}?sslmode=require`;

  // Probe the server's major version so we can use a matching pg_dump.
  // pg_dump refuses to dump from a server newer than itself; the local
  // postgres container may be on a different major than prod (e.g. local
  // was bootstrapped on 16, prod is 18). The local container's `psql`
  // is forwards-compatible enough to run `SHOW server_version` against
  // any modern Postgres, so we use it just for the version probe.
  console.log(`[pull] Probing prod server version ...`);
  const versionProbe = spawnSync(
    "docker",
    ["exec", "-i", LOCAL_POSTGRES_CONTAINER, "psql", dumpUrl, "-tAc", "SHOW server_version"],
    { cwd: PROJECT_ROOT, encoding: "utf8" },
  );
  if (versionProbe.status !== 0) {
    throw new Error(
      `Could not connect to prod Postgres for version probe: ${versionProbe.stderr}`,
    );
  }
  const versionStr = (versionProbe.stdout ?? "").trim();
  const majorMatch = versionStr.match(/^(\d+)/);
  if (!majorMatch) {
    throw new Error(`Unexpected server_version output: "${versionStr}"`);
  }
  const majorVersion = majorMatch[1];
  const dumpImage = `postgres:${majorVersion}`;
  console.log(`[pull] Prod server major version: ${majorVersion}. Using ${dumpImage} for pg_dump.`);

  // Pull the matching image up front (silent if cached). Without this, the
  // first run fails with a confusing "Unable to find image" stderr.
  spawnSync("docker", ["pull", dumpImage], { stdio: "inherit", cwd: PROJECT_ROOT });

  console.log(`[pull] Starting pg_dump in ephemeral ${dumpImage} container ...`);
  const excludeArgs = pgDumpExcludeArgs();
  const out = fs.createWriteStream(CACHE_DUMP_TMP);
  const child = spawn(
    "docker",
    [
      "run",
      "--rm",
      "-i",
      dumpImage,
      "pg_dump",
      dumpUrl,
      "--format=custom",
      "--no-owner",
      "--no-privileges",
      ...excludeArgs,
    ],
    { stdio: ["ignore", "pipe", "inherit"], cwd: PROJECT_ROOT },
  );

  child.stdout.pipe(out);
  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      out.end();
      if (code !== 0) {
        reject(new Error(`pg_dump exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });

  const stat = fs.statSync(CACHE_DUMP_TMP);
  if (stat.size < 1024) {
    throw new Error(
      `Dump file is suspiciously small (${stat.size} bytes). Check railway auth + DATABASE_PUBLIC_URL.`,
    );
  }
  fs.renameSync(CACHE_DUMP_TMP, CACHE_DUMP);
  console.log(`[pull] DB dump written: ${CACHE_DUMP} (${stat.size.toLocaleString()} bytes).`);

  // Capture migration count for drift detection at reset time. Reuse the
  // local container's psql — version skew doesn't matter for SELECT count(*).
  const migCount = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      LOCAL_POSTGRES_CONTAINER,
      "psql",
      dumpUrl,
      "-tAc",
      "SELECT count(*) FROM mikro_orm_migrations",
    ],
    { cwd: PROJECT_ROOT, encoding: "utf8" },
  );
  const migrationCount = parseInt((migCount.stdout ?? "0").trim(), 10);
  if (!Number.isFinite(migrationCount)) {
    console.warn(`[pull] Could not capture migration count; defaulting to 0.`);
    return { migrationCount: 0, majorVersion };
  }
  console.log(`[pull] Prod migration count: ${migrationCount}.`);
  return { migrationCount, majorVersion };
}

// ── Job 2: R2 image diff sync ──────────────────────────────────

async function syncR2Images(): Promise<{ images: ImageEntry[]; r2PublicBase: string; bucket: string }> {
  const accessKeyId = env("PROD_R2_ACCESS_KEY_ID");
  const secretAccessKey = env("PROD_R2_SECRET_ACCESS_KEY");
  const bucket = env("PROD_R2_BUCKET");
  const endpoint = env("PROD_R2_ENDPOINT");
  const r2PublicBase = env("PROD_R2_PUBLIC_BASE");

  console.log(`[pull] Listing R2 bucket ${bucket} via ${endpoint}.`);
  const s3 = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  fs.mkdirSync(CACHE_IMAGES, { recursive: true });
  const previous = loadManifest();
  const previousByKey = new Map<string, ImageEntry>();
  for (const e of previous?.images ?? []) previousByKey.set(e.key, e);

  // List all objects (paginate).
  const listed: ImageEntry[] = [];
  let continuationToken: string | undefined = undefined;
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of resp.Contents ?? []) {
      if (!obj.Key) continue;
      listed.push({
        key: obj.Key,
        etag: (obj.ETag ?? "").replace(/"/g, ""),
        size: obj.Size ?? 0,
      });
    }
    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);

  console.log(`[pull] R2 listing: ${listed.length} objects.`);

  // Diff: which need download?
  const toDownload: ImageEntry[] = [];
  for (const entry of listed) {
    const prev = previousByKey.get(entry.key);
    const localPath = path.join(CACHE_IMAGES, entry.key.replace(/[\/\\]/g, "__"));
    const localExists = fs.existsSync(localPath);
    if (!localExists || !prev || prev.etag !== entry.etag || prev.size !== entry.size) {
      toDownload.push(entry);
    }
  }
  console.log(`[pull] Images: ${toDownload.length} to download, ${listed.length - toDownload.length} unchanged.`);

  // Download with bounded concurrency.
  let downloadedCount = 0;
  const queue = [...toDownload];
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(DOWNLOAD_CONCURRENCY, queue.length); i++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const item = queue.shift();
        if (!item) return;
        const flatName = item.key.replace(/[\/\\]/g, "__");
        const localPath = path.join(CACHE_IMAGES, flatName);
        const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: item.key }));
        const body = resp.Body;
        if (!(body instanceof Readable)) {
          throw new Error(`Unexpected response body type for ${item.key}`);
        }
        await pipeline(body, fs.createWriteStream(localPath));
        downloadedCount++;
        if (downloadedCount % 10 === 0) {
          console.log(`[pull]   downloaded ${downloadedCount}/${toDownload.length}`);
        }
      }
    })());
  }
  await Promise.all(workers);
  if (toDownload.length > 0) {
    console.log(`[pull] Downloaded ${downloadedCount} images.`);
  }

  // Prune local files no longer in prod.
  const liveKeysFlat = new Set(listed.map((e) => e.key.replace(/[\/\\]/g, "__")));
  let pruned = 0;
  for (const local of fs.readdirSync(CACHE_IMAGES)) {
    if (!liveKeysFlat.has(local)) {
      fs.rmSync(path.join(CACHE_IMAGES, local));
      pruned++;
    }
  }
  if (pruned > 0) console.log(`[pull] Pruned ${pruned} stale local images.`);

  return { images: listed, r2PublicBase, bucket };
}

async function main() {
  loadEnvFile(path.join(PROJECT_ROOT, ".env"));

  console.log(`[pull] Excluding ${TRANSACTIONAL_TABLE_PATTERNS.length} transactional table patterns from dump.`);
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const [{ migrationCount, majorVersion }, imagesResult] = await Promise.all([
    dumpProdDb(),
    syncR2Images(),
  ]);

  const manifest: CacheManifest = {
    pulledAt: new Date().toISOString(),
    prodMigrationCount: migrationCount,
    prodPostgresMajorVersion: majorVersion,
    r2PublicBase: imagesResult.r2PublicBase,
    bucket: imagesResult.bucket,
    images: imagesResult.images,
  };
  fs.writeFileSync(CACHE_MANIFEST, JSON.stringify(manifest, null, 2));
  console.log(`[pull] ✓ Cache refreshed. Run \`npm run reset\` to rebuild dev from this snapshot.`);
}

main().catch((err) => {
  console.error("[pull] FAILED:", err);
  process.exit(1);
});
