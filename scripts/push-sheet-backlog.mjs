#!/usr/bin/env node
/**
 * Pushes the rows the sheet has and the database does not through `/api/sync`.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * `/api/sync` is a push endpoint: the Apps Script time-trigger POSTs to it, and
 * nothing in this repo makes that happen. When the trigger stops, the scraper
 * carries on filling the sheet and the site simply stops changing — no failed
 * run, no dead letter, no alert, because a run row is only opened once a
 * request has been authorised and parsed. On 2026-09-08 that gap was four days
 * and 1,626 rows.
 *
 * This is the catch-up. It reads the same feed the trigger reads, works out
 * which rows never landed, and posts them back through the same endpoint —
 * deliberately the endpoint and not the database directly, because that is what
 * writes `sync_runs`, records job changes, resolves update→job links, fires the
 * tagged revalidation and pings the search engines. Writing rows straight into
 * Postgres would leave a site that still served the old cached pages.
 *
 * It is not a replacement for the trigger. Fix the trigger; run this once to
 * recover what was missed while it was down.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *
 *   node scripts/push-sheet-backlog.mjs                 # dry run: counts only
 *   node scripts/push-sheet-backlog.mjs --apply
 *   node scripts/push-sheet-backlog.mjs --apply --kind=jobs
 *   node scripts/push-sheet-backlog.mjs --apply --feed=/tmp/feed.json
 *
 * Re-running is safe. Identity is `sha256(source_url + "\n" + title)`, the same
 * key both ingest paths use, so a row that landed on the last run is read back
 * as existing and is not sent again — and would be diffed to "unchanged" even
 * if it were.
 *
 * Environment (from .env.local, or exported):
 *
 *   NEXT_PUBLIC_SUPABASE_URL     project URL, to read what already exists
 *   SUPABASE_SECRET_KEY          service key, same
 *   SHEETS_SYNC_SECRET           the bearer token `/api/sync` expects
 *   APPS_SCRIPT_WEBAPP_URL       the feed, unless --feed points at a saved copy
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * The host is not incidental.
 *
 * The apex 308s to www, and following that redirect drops the `Authorization`
 * header — the request arrives unauthenticated, `/api/sync` answers 401, and
 * because the run row is opened after the auth check there is no trace of it
 * anywhere. Post to www or do not post.
 */
const SYNC_URL = "https://www.jobstrackr.in/api/sync";

/**
 * Batch bounds, and why there are two of them.
 *
 * Rows: `/api/sync` accepts up to 2,000, but both ingest paths then read the
 * existing rows with `dedupe_key IN (…)`, and PostgREST puts that list in the
 * URL — past roughly 300 keys the request comes back as a bare "Bad Request".
 * 150 stays well under it, and under the same wall in `uniqueSlugs`.
 *
 * Bytes: an update row carries its whole article body, so 150 of them can be
 * several megabytes. Vercel rejects a request body over 4.5 MB, so whichever
 * bound is reached first ends the batch.
 */
const MAX_ROWS = 150;
const MAX_BYTES = 1_500_000;

/** How many times to re-send a batch whose request never reached the endpoint. */
const MAX_ATTEMPTS = 3;

const args = new Set(process.argv.slice(2));
const arg = (name) =>
  process.argv.slice(2).find((a) => a.startsWith(`--${name}=`))?.split("=").slice(1).join("=");

const apply = args.has("--apply");
const only = arg("kind");
const feedPath = arg("feed");

function env() {
  const out = { ...process.env };
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !out[m[1]]) out[m[1]] = m[2].trim();
    }
  } catch {
    // Exported into the environment instead. Fine.
  }
  return out;
}

const E = env();
for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY", "SHEETS_SYNC_SECRET"]) {
  if (!E[key]) {
    console.error(`missing ${key}`);
    process.exit(1);
  }
}

const db = createClient(E.NEXT_PUBLIC_SUPABASE_URL, E.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

const dedupeKey = (url, title) =>
  createHash("sha256").update(`${url}\n${title}`).digest("hex").slice(0, 32);

/** Every `dedupe_key` a table holds, paged — the row count is well past PostgREST's cap. */
async function existingKeys(table) {
  const keys = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from(table).select("dedupe_key").range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    for (const row of data) if (row.dedupe_key) keys.add(row.dedupe_key);
    if (data.length < 1000) return keys;
  }
}

async function feed() {
  if (feedPath) return JSON.parse(readFileSync(feedPath, "utf8"));

  if (!E.APPS_SCRIPT_WEBAPP_URL) throw new Error("no --feed and no APPS_SCRIPT_WEBAPP_URL");
  // The whole sheet is tens of megabytes and the script needs well over a
  // minute to build it, so this is generous on purpose and saved on the way
  // past — a re-run should not have to ask for it again.
  const response = await fetch(
    `${E.APPS_SCRIPT_WEBAPP_URL}?secret=${encodeURIComponent(E.SHEETS_SYNC_SECRET)}`,
    { signal: AbortSignal.timeout(300_000), redirect: "follow" },
  );
  const text = await response.text();
  writeFileSync("/tmp/sheet-feed.json", text);
  const json = JSON.parse(text);
  if (json.ok === false) throw new Error(`feed: ${json.error}`);
  return json;
}

/** Rows split so that neither bound is crossed. */
function batches(rows) {
  const out = [];
  let batch = [];
  let bytes = 0;
  for (const row of rows) {
    const size = JSON.stringify(row).length;
    if (batch.length > 0 && (batch.length >= MAX_ROWS || bytes + size > MAX_BYTES)) {
      out.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(row);
    bytes += size;
  }
  if (batch.length > 0) out.push(batch);
  return out;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One batch, retried only on a failure that never reached the endpoint.
 *
 * A megabyte-and-a-half POST held open while the worker writes 150 rows is long
 * enough for the socket to be broken under it — this run lost its last batch to
 * an `EPIPE` after the eleven before it had gone through. That is not the
 * server saying no, and giving up on it strands rows for no reason.
 *
 * A response, of any status, is returned as it is. A 500 means the batch was
 * seen and something in it is wrong; sending it again would just fail again,
 * more slowly, and open a second `sync_runs` row saying so. Retrying is for
 * "the request never arrived", nothing else — and it is safe there because
 * ingestion is idempotent: a batch that did land is read back as unchanged.
 */
async function post(kind, rows, attempt = 1) {
  let response;
  try {
    response = await fetch(SYNC_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${E.SHEETS_SYNC_SECRET}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ kind, rows }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (error) {
    if (attempt > MAX_ATTEMPTS) return { status: 0, body: { error: String(error) } };
    console.log(`    ${String(error)} — retrying (${attempt}/${MAX_ATTEMPTS})`);
    await sleep(attempt * 5_000);
    return post(kind, rows, attempt + 1);
  }

  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { status: response.status, body };
}

const sheet = await feed();

const plan = [
  { kind: "jobs", table: "jobs", rows: sheet.jobs ?? [], url: (r) => r.source_url },
  {
    kind: "exam_updates",
    table: "exam_updates",
    rows: sheet.updates ?? [],
    url: (r) => r.source_url ?? r.url,
  },
].filter((p) => !only || p.kind === only);

const totals = { sent: 0, inserted: 0, updated: 0, unchanged: 0, failed: 0, batches: 0, errors: 0 };

for (const { kind, table, rows, url } of plan) {
  const known = await existingKeys(table);
  const missing = rows.filter((r) => {
    const u = url(r);
    return r.title && u && !known.has(dedupeKey(u, r.title));
  });

  const chunks = batches(missing);
  console.log(
    `\n${kind}: sheet has ${rows.length}, database has ${known.size}, ` +
      `${missing.length} never landed → ${chunks.length} batches`,
  );

  if (!apply) {
    console.log(`  dry run — nothing sent. Re-run with --apply.`);
    continue;
  }

  for (const [i, batch] of chunks.entries()) {
    const { status, body } = await post(kind, batch);
    totals.batches += 1;

    if (status !== 200) {
      totals.errors += 1;
      console.error(
        `  batch ${i + 1}/${chunks.length} (${batch.length} rows) → HTTP ${status} ` +
          `${JSON.stringify(body).slice(0, 300)}`,
      );
      continue;
    }

    totals.sent += batch.length;
    totals.inserted += body.inserted ?? 0;
    totals.updated += body.updated ?? 0;
    totals.unchanged += body.unchanged ?? 0;
    totals.failed += body.failed ?? 0;

    console.log(
      `  batch ${i + 1}/${chunks.length}: ${batch.length} sent → ` +
        `+${body.inserted ?? 0} new, ~${body.updated ?? 0} changed, ` +
        `${body.unchanged ?? 0} unchanged, ${body.failed ?? 0} dead-lettered` +
        (body.linked ? `, ${body.linked} linked` : "") +
        (body.closed ? `, ${body.closed} closed` : ""),
    );
  }
}

if (apply) {
  console.log(
    `\ntotal: ${totals.batches} batches, ${totals.sent} rows sent, ` +
      `+${totals.inserted} new, ~${totals.updated} changed, ` +
      `${totals.failed} dead-lettered, ${totals.errors} batches errored`,
  );
  // A dead-lettered row is a row the batch stepped over, which is the design
  // working; a batch that errored is rows that were never considered, and is
  // the thing to look at.
  if (totals.errors > 0) process.exitCode = 1;
}
