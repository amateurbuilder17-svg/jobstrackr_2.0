#!/usr/bin/env node
/**
 * Flattens the legacy metadata blob that landed in `job_details.overview`.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The 6,003 job rows in this project were not loaded through `/api/sync` —
 * `sync_runs` holds three one-row tests and nothing else. They were copied
 * across directly, which meant the old project's `job_metadata` blob was
 * written into `job_details.overview` verbatim, still nested, instead of being
 * spread across the typed columns by `toJobDetailPayload`.
 *
 * So every column the detail page actually reads is NULL on every row:
 *
 *   important_dates 0/6003     (3,684 present inside the blob)
 *   application_fees 0/6003    (1,633)
 *   vacancies_detail 0/6003    (3,332)
 *   selection_process 0/6003   (2,295)
 *   salary_text 0/6003         (4,835)
 *   age_limit_text 0/6003      (4,234)
 *   notification_pdf 0/6003    (4,695)
 *
 * and `overview` itself holds the raw blob, which `toOverview` correctly
 * refuses to render because its values are objects rather than strings. The
 * page was never thin; the data was never unpacked.
 *
 * ── Why it imports the app's parser rather than carrying its own ───────────
 * `details.ts` says it: a backfill that normalises differently from the worker
 * produces two populations of rows that render differently, and the difference
 * only shows up on whichever pages nobody checked. This script does no parsing.
 * It reads a blob, hands it to `toJobDetailPayload`, and writes what comes back.
 *
 * ── What it will not do ────────────────────────────────────────────────────
 * It never overwrites a column that already holds something. `description` and
 * `eligibility_text` are populated on 4,090 and 5,622 rows and are not in the
 * blob; parsing the blob yields NULL for both, and writing that NULL would
 * delete the only prose the page has.
 *
 * The one exception is `overview`, which is always replaced: it is the blob
 * being unpacked, and leaving the raw copy behind would double the storage and
 * keep feeding the renderer something it cannot use.
 *
 * Usage:
 *
 *   node scripts/reparse-job-details.mjs              # dry run, whole table
 *   node scripts/reparse-job-details.mjs --apply
 *   node scripts/reparse-job-details.mjs --limit 200  # sample, either mode
 */

import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/* ── Resolving the app's modules from a plain script ────────────────────── */

// The parser lives behind the `@/` alias and extensionless relative imports,
// both of which are tsconfig conventions that Node's resolver knows nothing
// about. Fifteen lines of hook is cheaper than a build step or a dev
// dependency, and keeps this script runnable with nothing but `node`.
const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");

registerHooks({
  resolve(specifier, context, nextResolve) {
    let spec = specifier;

    if (spec.startsWith("@/")) {
      const target = path.join(SRC, spec.slice(2));
      spec = pathToFileURL(existsSync(target) ? target : `${target}.ts`).href;
    }

    try {
      return nextResolve(spec, context);
    } catch (error) {
      // Extensionless relative import: `./links` → `./links.ts`.
      for (const extension of [".ts", ".tsx", "/index.ts"]) {
        try {
          return nextResolve(spec + extension, context);
        } catch {
          // Try the next one; the original error is rethrown below.
        }
      }
      throw error;
    }
  },
});

const { toJobDetailPayload } = await import("../src/lib/sync/details.ts");
// The fee pass reads the stored `application_fees` column rather than a feed
// row, so it uses these directly instead of `feeFromTable`, which wraps them
// for the ingest worker's benefit.
const { maxFee, toFeeRows } = await import("../src/lib/jobs/detail-shape.ts");

/* ── Configuration ─────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const LIMIT = Number(valueOf("--limit") ?? Infinity);

/** Rows per read. Blobs average ~4.4 kB, so this is well under a megabyte. */
const READ_CHUNK = 150;
/** Rows per write. One upsert statement; PostgREST builds a single INSERT. */
const WRITE_CHUNK = 100;

loadEnvLocal();

const URL_BASE = required("NEXT_PUBLIC_SUPABASE_URL");
const KEY = required("SUPABASE_SECRET_KEY");

/**
 * Every column of `job_details` this script is allowed to touch.
 *
 * Listed explicitly and written on every row, because a PostgREST bulk upsert
 * builds one INSERT from the batch: an object missing a key that its neighbour
 * has is a 400, not a partial write.
 */
const COLUMNS = [
  "description",
  "eligibility_text",
  "experience_text",
  "apply_link",
  "official_website",
  "notification_pdf",
  "important_dates",
  "application_fees",
  "vacancies_detail",
  "selection_process",
  "overview",
  "eligibility_profile",
  // Added by migration 0019, after the blob was written, so nothing can
  // already be holding a value here to protect.
  "salary_text",
  "age_limit_text",
];

/* ── Read ──────────────────────────────────────────────────────────────── */

/** The keyset seed. `job_id` is a uuid, and `gt.""` is a 22P02 from Postgres. */
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

async function* readRows() {
  let after = NIL_UUID;
  let total = 0;

  for (;;) {
    // Keyset on the primary key, not OFFSET. Same reason as the old-project
    // backfill: offset gets slower every page and is what times out.
    const url =
      `${URL_BASE}/rest/v1/job_details` +
      `?select=job_id,${COLUMNS.join(",")}` +
      `&overview=not.is.null&job_id=gt.${encodeURIComponent(after)}` +
      `&order=job_id.asc&limit=${READ_CHUNK}`;

    const response = await fetch(url, { headers: authHeaders() });
    if (!response.ok) {
      throw new Error(`read job_details: ${response.status} ${await response.text()}`);
    }

    const rows = await response.json();
    if (rows.length === 0) return;

    for (const row of rows) {
      yield row;
      total += 1;
      if (total >= LIMIT) return;
    }

    after = rows[rows.length - 1].job_id;
  }
}

/**
 * The rows whose fee table can fill an empty `jobs.application_fee`.
 *
 * A card cannot reach `job_details` — that separation is the point of the two
 * tables — so without this column a listing shows no fee at all, and the detail
 * page has to recover the figure from the table on every render.
 *
 * Filtered server-side rather than by walking the table: this is a few hundred
 * rows out of six thousand, and PostgREST can express exactly which ones.
 */
async function readRowsNeedingFee() {
  const url =
    `${URL_BASE}/rest/v1/job_details` +
    `?select=job_id,application_fees,jobs!inner(application_fee)` +
    `&application_fees=not.is.null&jobs.application_fee=is.null` +
    `&order=job_id.asc&limit=1000`;

  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) {
    throw new Error(`read fee candidates: ${response.status} ${await response.text()}`);
  }
  return response.json();
}

/* ── Transform ─────────────────────────────────────────────────────────── */

/**
 * The blob, reshaped into something `toJobDetailPayload` reads as a feed row.
 *
 * Two adjustments, both about not losing anything on the way through:
 *
 *   `overview` is rebuilt from the blob's own nested overview table plus the
 *   loose scalars that have no column of their own. `exam_date` is the one that
 *   matters — it is on the source notification and there is nowhere else for it
 *   to go. `employment_type` is deliberately dropped: it reads "FULL_TIME" on
 *   5,885 of 6,003 rows, which is JSON-LD boilerplate rather than information.
 *
 *   `eligibility_profile` is carried across untouched. `toJobDetailPayload`
 *   returns NULL for it because a live feed row has no such field, but the blob
 *   does, on 3,111 rows, and migration 0004 keeps the column precisely so the
 *   typed eligibility columns can be re-derived when the parser improves.
 */
function toFeedRow(blob) {
  const nested = isRecord(blob.overview) ? blob.overview : {};
  const extras = {};
  if (blob.exam_date) extras.exam_date = blob.exam_date;

  return { ...blob, overview: { ...nested, ...extras } };
}

/**
 * Parsed values merged over the row, without overwriting anything real.
 *
 * Returns null when the row would not change, so an unchanged row costs no
 * write. Re-running this script over a table it has already flattened is
 * expected to report zero changes.
 */
function toUpdate(row) {
  const blob = row.overview;
  if (!isRecord(blob)) return null;

  const parsed = toJobDetailPayload(toFeedRow(blob));
  // Carried across rather than parsed; see `toFeedRow`.
  parsed.eligibility_profile = blob.eligibility_profile ?? null;

  const update = { job_id: row.job_id };
  let changed = false;

  for (const column of COLUMNS) {
    // `overview` is the blob being unpacked. It is replaced rather than
    // preserved — including when the parse yields nothing, because the raw
    // copy is exactly what the renderer cannot use.
    const existing = column === "overview" ? null : (row[column] ?? null);
    const next = existing ?? parsed[column] ?? null;

    update[column] = next;
    if (!same(next, row[column] ?? null)) changed = true;
  }

  return changed ? update : null;
}

/* ── Write ─────────────────────────────────────────────────────────────── */

async function writeDetails(batch) {
  const response = await fetch(`${URL_BASE}/rest/v1/job_details`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(batch),
  });

  if (!response.ok) {
    throw new Error(`write job_details: ${response.status} ${await response.text()}`);
  }
}

/**
 * The card's fee figure, for the rows that have a fee table and no figure.
 *
 * 264 rows. The detail page already recovers this at render time from the fee
 * table, so this is for the list: a card cannot reach `job_details`, by design,
 * so without the column it shows no fee at all.
 *
 * One PATCH per row rather than a bulk upsert: an upsert against `jobs` would
 * have to carry every not-null column of a table this script has no business
 * rewriting.
 */
async function writeFee(jobId, fee) {
  const response = await fetch(
    `${URL_BASE}/rest/v1/jobs?id=eq.${jobId}&application_fee=is.null`,
    {
      method: "PATCH",
      headers: {
        ...authHeaders(),
        "content-type": "application/json",
        prefer: "return=minimal",
      },
      body: JSON.stringify({ application_fee: fee }),
    },
  );

  if (!response.ok) {
    throw new Error(`write jobs.application_fee: ${response.status} ${await response.text()}`);
  }
}

/* ── Run ───────────────────────────────────────────────────────────────── */

const stats = {
  seen: 0,
  changed: 0,
  unchanged: 0,
  fees: 0,
  free: 0,
  gained: Object.fromEntries(COLUMNS.map((c) => [c, 0])),
};

let batch = [];

for await (const row of readRows()) {
  stats.seen += 1;

  const update = toUpdate(row);
  if (!update) {
    stats.unchanged += 1;
    continue;
  }

  stats.changed += 1;
  for (const column of Object.keys(stats.gained)) {
    if ((row[column] ?? null) === null && update[column] !== null) stats.gained[column] += 1;
  }

  batch.push(update);
  if (batch.length >= WRITE_CHUNK) {
    if (APPLY) await writeDetails(batch);
    batch = [];
    process.stdout.write(`\r  ${stats.seen} rows…`);
  }
}

if (batch.length > 0 && APPLY) await writeDetails(batch);

// ── Pass 2: the card's fee figure ────────────────────────────────────────
// Runs after the details and reads them back, so it sees the `application_fees`
// this run just wrote. Its own query, filtered server-side to exactly the rows
// that can change — a few hundred, rather than re-reading the whole table.
for (const row of await readRowsNeedingFee()) {
  const fee = maxFee(toFeeRows(row.application_fees));
  if (fee === null) continue;
  if (APPLY) await writeFee(row.job_id, fee);
  stats.fees += 1;
  if (fee === 0) stats.free += 1;
}

process.stdout.write("\r");
console.log(`\n${APPLY ? "Applied" : "Dry run"} — ${stats.seen} rows read\n`);
console.log(`  changed    ${stats.changed}`);
console.log(`  unchanged  ${stats.unchanged}`);
console.log(
  `  fee writes ${stats.fees} (jobs.application_fee, only where null; ` +
    `${stats.free} of them "no fee")\n`,
);
console.log("  columns gaining a value:");
for (const [column, count] of Object.entries(stats.gained)) {
  if (count > 0) console.log(`    ${column.padEnd(20)} ${count}`);
}
if (!APPLY) console.log("\nNothing was written. Re-run with --apply.");

/* ── Helpers ───────────────────────────────────────────────────────────── */

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function same(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

function authHeaders() {
  return { apikey: KEY, authorization: `Bearer ${KEY}` };
}

function valueOf(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (put it in .env.local)`);
  return value;
}

/** `.env.local` is what every other script here reads; no dotenv dependency. */
function loadEnvLocal() {
  const file = path.join(ROOT, ".env.local");
  if (!existsSync(file)) return;

  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, raw] = match;
    if (process.env[key]) continue;
    process.env[key] = raw.trim().replace(/^["']|["']$/g, "");
  }
}
