#!/usr/bin/env node
/**
 * Replays the old project's content through the real ingest path.
 *
 * The important word is *replays*. This script does no mapping, no
 * normalisation and no writing of its own — it reads rows out of the old
 * Supabase project and POSTs them to `/api/sync`, which is the same endpoint
 * the Apps Script trigger calls every hour.
 *
 * That is the whole design. A backfill with its own copy of the parser produces
 * two populations of rows that render differently, and the difference only
 * shows up on whichever pages nobody checked. Here there is one parser, one
 * dedupe key, one slug generator, one blocklist; a row imported today and the
 * same row re-scraped tomorrow land identically, and the second one writes
 * nothing because the content hash matches.
 *
 * Usage:
 *
 *   node scripts/backfill-from-old-project.mjs            # dry run, 1 batch
 *   node scripts/backfill-from-old-project.mjs --apply
 *   node scripts/backfill-from-old-project.mjs --apply --kind exam_updates
 *
 * Environment (in .env.local, or exported):
 *
 *   OLD_SUPABASE_URL          the restricted project's URL
 *   OLD_SUPABASE_SECRET_KEY   its service-role key
 *   SYNC_ENDPOINT             defaults to http://localhost:3100/api/sync
 *   SHEETS_SYNC_SECRET        the same secret the Apps Script trigger sends
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ── Configuration ─────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const KIND = valueOf("--kind") ?? "jobs";
const LIMIT = Number(valueOf("--limit") ?? Infinity);

/** Rows per read from the old project. It times out (57014) on large scans —
 *  see docs/DATA-EXPORT.md — so this is keyset paginated and deliberately
 *  small. Job rows average 6 kB; 300 of them is under 2 MB. */
const READ_CHUNK = KIND === "jobs" ? 300 : 200;
/** Rows per POST. The endpoint caps a request at 2000; this is well under it
 *  so one slow batch cannot exhaust the serverless time limit. */
const POST_CHUNK = 100;

loadEnvLocal();

const OLD_URL = required("OLD_SUPABASE_URL");
const OLD_KEY = required("OLD_SUPABASE_SECRET_KEY");
const ENDPOINT = process.env.SYNC_ENDPOINT ?? "http://localhost:3100/api/sync";
const SECRET = required("SHEETS_SYNC_SECRET");

/* ── What to read ──────────────────────────────────────────────────────── */

// Named columns, not `*`. The old `jobs` table is 6 kB a row and most of that
// is `job_metadata`, which this genuinely needs; everything else it does not.
const JOB_COLUMNS = [
  "id",
  "title",
  "department",
  "location",
  "state",
  "vacancies",
  "qualification",
  "salary_min",
  "salary_max",
  "age_min",
  "age_max",
  "application_fee",
  "last_date",
  "last_date_display",
  "apply_link",
  "official_website",
  "description",
  "eligibility",
  "experience",
  "source_url",
  "slug",
  "created_at",
  "job_metadata",
].join(",");

const UPDATE_COLUMNS = [
  "id",
  "title",
  "category",
  "summary",
  "url",
  "published_date",
  "scraped_at",
  "important_dates",
  "download_links",
  "sections",
  "overview",
  "exam_name",
  "conducting_body",
].join(",");

/**
 * Old row → the feed shape `/api/sync` expects.
 *
 * Only renames. Everything that requires a decision — which URL is safe, what a
 * fee table means, how a date is written — happens on the other side of the
 * HTTP call, in the code that also handles the live feed.
 */
function toJobFeedRow(row) {
  return {
    title: row.title,
    source_url: row.source_url ?? row.apply_link ?? `legacy:${row.slug ?? row.id}`,
    organization: row.department,
    location: row.location,
    state: row.state,
    vacancies: row.vacancies,
    qualification_summary: row.qualification,
    salary_min: row.salary_min,
    salary_max: row.salary_max,
    age_min: row.age_min,
    age_max: row.age_max,
    application_fee: row.application_fee,
    last_date: row.last_date,
    last_date_display: row.last_date_display,
    apply_link: row.apply_link,
    official_website: row.official_website,
    description: row.description,
    eligibility_text: row.eligibility,
    experience_text: row.experience,
    // The blob the whole backfill exists for. `toJobDetailPayload` reads
    // through it, which is why no mapping is needed here.
    job_metadata: row.job_metadata,
  };
}

function toUpdateFeedRow(row) {
  return {
    title: row.title,
    source_url: row.url,
    category: row.category,
    summary: row.summary,
    published_date: row.published_date,
    organization: row.conducting_body,
    exam_name: row.exam_name,
    important_dates: row.important_dates,
    download_links: row.download_links,
    sections: row.sections,
    overview: row.overview,
  };
}

/* ── Read ──────────────────────────────────────────────────────────────── */

async function* readOldRows() {
  const table = KIND === "jobs" ? "jobs" : "exam_updates";
  const columns = KIND === "jobs" ? JOB_COLUMNS : UPDATE_COLUMNS;

  let after = "";
  let total = 0;

  for (;;) {
    // Keyset pagination on id::text, not OFFSET. Offset gets slower every page
    // and is exactly what times out on this database.
    const url =
      `${OLD_URL}/rest/v1/${table}?select=${columns}` +
      `&id=gt.${encodeURIComponent(after)}&order=id.asc&limit=${READ_CHUNK}`;

    const response = await fetch(url, {
      headers: { apikey: OLD_KEY, authorization: `Bearer ${OLD_KEY}` },
    });

    if (!response.ok) {
      throw new Error(`read ${table}: ${response.status} ${await response.text()}`);
    }

    const rows = await response.json();
    if (rows.length === 0) return;

    yield rows;

    total += rows.length;
    after = rows[rows.length - 1].id;
    if (total >= LIMIT) return;
  }
}

/* ── Write ─────────────────────────────────────────────────────────────── */

async function post(rows) {
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${SECRET}` },
    body: JSON.stringify({ kind: KIND, rows }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`sync: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

/* ── Run ───────────────────────────────────────────────────────────────── */

const totals = { seen: 0, inserted: 0, updated: 0, unchanged: 0, failed: 0, detailsWritten: 0 };

console.log(`${APPLY ? "Backfilling" : "DRY RUN —"} ${KIND} from ${OLD_URL}`);
console.log(`  → ${ENDPOINT}\n`);

for await (const chunk of readOldRows()) {
  const mapped = chunk.map(KIND === "jobs" ? toJobFeedRow : toUpdateFeedRow);

  if (!APPLY) {
    console.log(`Read ${mapped.length} rows. First one, as the endpoint would see it:\n`);
    console.log(JSON.stringify(mapped[0], null, 2).slice(0, 2400));
    console.log(
      `\nNothing was written. Re-run with --apply.\n` +
        `Detail fields present in this sample: ` +
        Object.entries(mapped[0] ?? {})
          .filter(([, v]) => v !== null && v !== undefined && v !== "")
          .map(([k]) => k)
          .join(", "),
    );
    break;
  }

  for (let i = 0; i < mapped.length; i += POST_CHUNK) {
    const batch = mapped.slice(i, i + POST_CHUNK);
    const result = await post(batch);
    for (const key of Object.keys(totals)) totals[key] += result[key] ?? 0;
    process.stdout.write(
      `\r  ${totals.seen} seen · ${totals.inserted} new · ${totals.updated} updated · ` +
        `${totals.unchanged} unchanged · ${totals.detailsWritten} details · ${totals.failed} failed`,
    );
  }
}

if (APPLY) {
  console.log("\n\nDone.");
  if (totals.failed > 0) {
    console.log(
      `${totals.failed} rows failed — they are in sync_dead_letter with their payload.`,
    );
  }
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function valueOf(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. See the header of this file.`);
    process.exit(1);
  }
  return value;
}

/** Reads .env.local without a dependency. Node does not do this for scripts. */
function loadEnvLocal() {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = readFileSync(resolve(process.cwd(), file), "utf8");
      for (const line of text.split("\n")) {
        const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!match) continue;
        const [, key, raw] = match;
        if (process.env[key] === undefined) {
          process.env[key] = raw.replace(/^["']|["']$/g, "");
        }
      }
    } catch {
      // Absent is fine — the variables may be exported already.
    }
  }
}
