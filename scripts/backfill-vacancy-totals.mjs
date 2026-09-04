#!/usr/bin/env node
/**
 * Fills `jobs.vacancies` from the vacancy breakdown table, where it is empty.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * 727 of the 2,601 published rows have no `vacancies`. The feed writes the
 * literal string "Not Found" into `vacancies_display` for 551 of them, so a
 * fifth of every listing page announced "Not Found" in the slot where a count
 * belongs — and the detail page printed "Check notice" two sections above a
 * "Vacancy breakdown" table whose "Total Posts" column stated the figure.
 *
 * `totalVacancies` reads that table. The detail page now applies it at render
 * time, but a job *card* cannot: the breakdown lives in `job_details`, and a
 * list query must never reach into the cold table. So the figure has to be in
 * the `jobs` row, which is what ingest does from now on (`vacanciesFromTable`)
 * and what this script does for the rows already in the table.
 *
 * It is the same shape as the fee pass in `reparse-job-details.mjs`, for the
 * same reason, and it imports the app's parser rather than carrying its own —
 * a backfill that computes differently from the worker produces two populations
 * of rows that disagree, and the disagreement shows up on whichever page nobody
 * checked.
 *
 * ── What it will not do ────────────────────────────────────────────────────
 * It never overwrites a stated count. A notification's own headline figure is
 * better than a table that may list only some of the posts: checked against the
 * 561 rows that have both, the parser agrees exactly on 537 and the differences
 * are almost all tables that are partial. So the update is guarded twice — the
 * read asks for `jobs.vacancies=is.null`, and the PATCH repeats the condition,
 * so a row that gained a count between the two is left alone.
 *
 * `vacancies_display` is left as it is. "Not Found" is now read as the
 * placeholder it always was (`formatVacancies`), so rewriting 551 rows to say
 * the same thing would be egress and cache invalidation spent on nothing.
 *
 * Usage:
 *
 *   node scripts/backfill-vacancy-totals.mjs             # dry run
 *   node scripts/backfill-vacancy-totals.mjs --apply
 *   node scripts/backfill-vacancy-totals.mjs --limit 50  # sample, either mode
 */

import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/* ── Resolving the app's modules from a plain script ────────────────────── */

// Same fifteen lines as `reparse-job-details.mjs`: the parser lives behind the
// `@/` alias and extensionless relative imports, neither of which Node resolves.
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

// The stored column is already in the normalised shape, so `toVacancyTable` is
// idempotent here — it runs anyway, because it is what narrows JSONB to a type.
const { toVacancyTable, totalVacancies } = await import("../src/lib/jobs/detail-shape.ts");

/* ── Configuration ─────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const LIMIT = Number(valueOf("--limit") ?? Infinity);

/** Rows per read. Breakdown tables are small; this stays well under a MB. */
const READ_CHUNK = 200;

loadEnvLocal();

const URL_BASE = required("NEXT_PUBLIC_SUPABASE_URL");
const KEY = required("SUPABASE_SECRET_KEY");

/* ── Read ──────────────────────────────────────────────────────────────── */

/** The keyset seed. `job_id` is a uuid, and `gt.""` is a 22P02 from Postgres. */
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/**
 * Rows with a breakdown and no count, filtered server-side.
 *
 * Keyset on the primary key rather than OFFSET, which gets slower every page
 * and is what eventually times out.
 */
async function* readCandidates() {
  let after = NIL_UUID;
  let total = 0;

  for (;;) {
    const url =
      `${URL_BASE}/rest/v1/job_details` +
      `?select=job_id,vacancies_detail,jobs!inner(slug,vacancies)` +
      `&vacancies_detail=not.is.null&jobs.vacancies=is.null` +
      `&job_id=gt.${encodeURIComponent(after)}` +
      `&order=job_id.asc&limit=${READ_CHUNK}`;

    const response = await fetch(url, { headers: authHeaders() });
    if (!response.ok) {
      throw new Error(`read candidates: ${response.status} ${await response.text()}`);
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

/* ── Write ─────────────────────────────────────────────────────────────── */

/**
 * One PATCH per row rather than a bulk upsert: an upsert against `jobs` would
 * have to carry every not-null column of a table this script has no business
 * rewriting.
 *
 * `vacancies=is.null` in the filter is the second guard — a row that gained a
 * stated count since the read is skipped by Postgres rather than overwritten.
 */
async function writeVacancies(jobId, vacancies) {
  const response = await fetch(`${URL_BASE}/rest/v1/jobs?id=eq.${jobId}&vacancies=is.null`, {
    method: "PATCH",
    headers: {
      ...authHeaders(),
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify({ vacancies }),
  });

  if (!response.ok) {
    throw new Error(`write jobs.vacancies: ${response.status} ${await response.text()}`);
  }
}

/* ── Run ───────────────────────────────────────────────────────────────── */

const stats = { seen: 0, filled: 0, unreadable: 0 };
const sample = [];

for await (const row of readCandidates()) {
  stats.seen += 1;

  const total = totalVacancies(toVacancyTable(row.vacancies_detail));
  if (total === null) {
    stats.unreadable += 1;
    continue;
  }

  if (APPLY) await writeVacancies(row.job_id, total);
  stats.filled += 1;
  if (sample.length < 15) sample.push([row.jobs.slug, total]);
}

console.log(
  `\n${APPLY ? "Applied" : "Dry run"} — ${stats.seen} rows with a breakdown and no count\n`,
);
console.log(`  filled      ${stats.filled}`);
console.log(`  no total    ${stats.unreadable}  (breakdown has no countable column)\n`);
console.log("  sample:");
for (const [slug, total] of sample) console.log(`    ${String(total).padStart(6)}  ${slug}`);
if (!APPLY) console.log("\nNothing was written. Re-run with --apply.");

/* ── Helpers ───────────────────────────────────────────────────────────── */

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
