#!/usr/bin/env node
/**
 * Recovers the `official_links` the old project holds and this one never got.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The old `exam_updates` table kept an update's links in three columns:
 *
 *   official_links   4,523 / 5,784 rows — the notification PDF, the "Direct
 *                    Link to Check Result", the department's own site
 *   download_links   1,941 / 5,784 rows
 *   related_links    5,661 / 5,784 rows — almost entirely the aggregator's own
 *                    Telegram bot, which the blocklist drops
 *
 * `sync/updates.ts` folds all of those into one `download_links` column, which
 * is the right shape: they are one list to a reader. But the migration into
 * this project only ever carried `download_links` — `UPDATE_COLUMNS` in
 * `backfill-from-old-project.mjs` does not name `official_links`, so the
 * ingest's `toDownloadLinks(row.official_links)` was always handed undefined.
 *
 * The result, measured across all 5,374 rows in production:
 *
 *   updates with no links at all                     3,551
 *   …of those, ones the old project has links for    3,224
 *
 * So three in five update pages show no way to reach the thing they are about.
 * On an admit-card page that is the entire point of the page.
 *
 * ── Why it does not replay through /api/sync ───────────────────────────────
 * The same reason `--kind jobs` is refused in the other script, and it is worth
 * being explicit because the fix looks like a re-ingest: `dedupe_key` is NULL
 * on all 5,374 rows, so the ingest's "have I seen this?" lookup matches
 * nothing and every row would be inserted a second time. Enriching rows that
 * already exist is an update path, and this is that script.
 *
 * ── What it will not do ────────────────────────────────────────────────────
 * It never removes a link that is already stored: the recovered ones are
 * appended to what the row holds, de-duplicated by URL. A row whose merged list
 * is identical to its current one is not written at all.
 *
 * Every URL goes through the app's own `toUrl`, so a recovered link is held to
 * the same blocklist as a freshly ingested one — the old project stored the
 * WhatsApp and Telegram invites that this one refuses, and a backfill is not a
 * way around that. Labels go through the app's own `linkLabel`, so a recovered
 * "Click here" is named the same way a live one would be.
 *
 * Usage:
 *
 *   node scripts/recover-update-links.mjs               # dry run, whole table
 *   node scripts/recover-update-links.mjs --limit 200   # sample, either mode
 *   node scripts/recover-update-links.mjs --apply
 *
 * Reads the old project through OLD_SUPABASE_URL / OLD_SUPABASE_SECRET_KEY,
 * which for this migration are the `VITE_SUPABASE_URL` and `SUPABASE_SERVICE_KEY`
 * in the old project's own `.env`.
 */

import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/* ── Resolving the app's modules from a plain script ────────────────────── */

// Same fifteen-line hook as `reparse-job-details.mjs`, and for the same reason:
// the normalisers live behind the `@/` alias, and a backfill that normalises
// differently from the worker produces two populations of rows that render
// differently.
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

const { toUrl } = await import("../src/lib/sync/links.ts");
const { linkLabel } = await import("../src/lib/updates/detail-shape.ts");

/* ── Configuration ─────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const LIMIT = Number(valueOf("--limit") ?? Infinity);

const READ_CHUNK = 1000;
const WRITE_CHUNK = 100;

loadEnvLocal();

const URL_BASE = required("NEXT_PUBLIC_SUPABASE_URL");
const KEY = required("SUPABASE_SECRET_KEY");
const OLD_URL = required("OLD_SUPABASE_URL");
const OLD_KEY = required("OLD_SUPABASE_SECRET_KEY");

/* ── Read ──────────────────────────────────────────────────────────────── */

async function readAll(base, key, pathAndQuery, label) {
  const out = [];
  for (let offset = 0; ; offset += READ_CHUNK) {
    const url = `${base}/rest/v1/${pathAndQuery}&limit=${READ_CHUNK}&offset=${offset}`;
    const response = await fetch(url, {
      headers: { apikey: key, authorization: `Bearer ${key}` },
    });
    if (!response.ok) {
      throw new Error(`read ${label}: ${response.status} ${await response.text()}`);
    }
    const rows = await response.json();
    out.push(...rows);
    if (rows.length < READ_CHUNK) return out;
  }
}

/* ── Match ─────────────────────────────────────────────────────────────── */

/**
 * The join key.
 *
 * `source_url` in this project is a verbatim copy of the old `url`, and it
 * resolves 5,374 of 5,374 rows on its own. The normalised title is a fallback
 * for rows whose URL was rewritten between the two projects; it is checked
 * second so an exact URL match always wins.
 */
const normaliseTitle = (value) =>
  (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/* ── Transform ─────────────────────────────────────────────────────────── */

/**
 * The merged list, or null when nothing would change.
 *
 * Order is deliberate: what the row already has comes first, so a page that
 * already leads with the right button keeps leading with it. `primaryLinks`
 * on the detail page reads this order when it picks the hero action.
 */
function mergeLinks(current, recovered, category) {
  const out = [];
  const seen = new Set();

  const push = (rawLabel, rawUrl) => {
    const url = toUrl(rawUrl);
    if (!url) return;
    const key = url.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    // The update's own category is the last fallback `linkLabel` reaches for,
    // and it is the difference between a bare "Official link" and "Admit card
    // link" on a URL that names nothing.
    out.push({ label: linkLabel(rawLabel ?? "", url, category), url });
  };

  for (const link of current ?? []) push(link?.label ?? link?.text, link?.url);
  for (const link of recovered ?? []) push(link?.text ?? link?.label, link?.url);

  if (out.length === 0) return null;

  // Unchanged rows are not written. Comparing the rendered pair rather than the
  // raw objects means a row whose only difference is a re-labelled "Click here"
  // still counts as a change, which is the point — that relabelling is half of
  // what makes the recovered links readable.
  const before = JSON.stringify((current ?? []).map((l) => [l?.label ?? l?.text, l?.url]));
  const after = JSON.stringify(out.map((l) => [l.label, l.url]));
  return before === after ? null : out;
}

/* ── Write ─────────────────────────────────────────────────────────────── */

/**
 * One PATCH per row.
 *
 * A bulk upsert against `exam_update_details` would have to carry every other
 * column of a row this script has no business rewriting — `sections`, `body`,
 * `overview` — and an object missing a key its neighbour has is a 400 from
 * PostgREST, not a partial write.
 */
async function writeLinks(examUpdateId, links) {
  const response = await fetch(
    `${URL_BASE}/rest/v1/exam_update_details?exam_update_id=eq.${examUpdateId}`,
    {
      method: "PATCH",
      headers: {
        apikey: KEY,
        authorization: `Bearer ${KEY}`,
        "content-type": "application/json",
        prefer: "return=minimal",
      },
      body: JSON.stringify({ download_links: links }),
    },
  );

  if (!response.ok) {
    throw new Error(`write ${examUpdateId}: ${response.status} ${await response.text()}`);
  }
}

/* ── Run ───────────────────────────────────────────────────────────────── */

console.log("reading the old project…");
const old = await readAll(
  OLD_URL,
  OLD_KEY,
  "exam_updates?select=url,title,official_links,download_links,related_links&order=scraped_at.desc",
  "old exam_updates",
);
console.log(`  ${old.length} rows`);

const byUrl = new Map();
const byTitle = new Map();
for (const row of old) {
  if (row.url && !byUrl.has(row.url)) byUrl.set(row.url, row);
  const key = normaliseTitle(row.title);
  if (key && !byTitle.has(key)) byTitle.set(key, row);
}

console.log("reading this project…");
const current = await readAll(
  URL_BASE,
  KEY,
  "exam_updates?select=id,title,source_url,category,detail:exam_update_details(download_links)&order=scraped_at.desc",
  "exam_updates",
);
console.log(`  ${current.length} rows\n`);

const stats = {
  seen: 0,
  matched: 0,
  unmatched: 0,
  changed: 0,
  gainedFromNothing: 0,
  linksAdded: 0,
};
const samples = [];
let pending = [];

for (const row of current) {
  if (stats.seen >= LIMIT) break;
  stats.seen += 1;

  const match = byUrl.get(row.source_url) ?? byTitle.get(normaliseTitle(row.title));
  if (!match) {
    stats.unmatched += 1;
    continue;
  }
  stats.matched += 1;

  const existing = row.detail?.download_links ?? [];
  // `related_links` is merged too. It is almost entirely the old aggregator's
  // Telegram bot and `toUrl` drops all of it, but the handful of real
  // destinations in there are worth the two words it costs to include.
  const recovered = [...(match.official_links ?? []), ...(match.related_links ?? [])];
  const merged = mergeLinks(existing, recovered, row.category);
  if (!merged) continue;

  stats.changed += 1;
  stats.linksAdded += merged.length - existing.length;
  if (existing.length === 0) stats.gainedFromNothing += 1;
  if (samples.length < 5)
    samples.push({ title: row.title, before: existing.length, links: merged });

  pending.push({ id: row.id, links: merged });
  if (pending.length >= WRITE_CHUNK) {
    if (APPLY) for (const item of pending) await writeLinks(item.id, item.links);
    pending = [];
    process.stdout.write(`\r  ${stats.changed} rows to change…`);
  }
}

if (APPLY) for (const item of pending) await writeLinks(item.id, item.links);

console.log(`\n\n${APPLY ? "Applied" : "Dry run"} — ${stats.seen} rows read\n`);
console.log(`  matched to an old row      ${stats.matched}`);
console.log(`  no match                   ${stats.unmatched}`);
console.log(`  rows changed               ${stats.changed}`);
console.log(`  …that had no links at all  ${stats.gainedFromNothing}`);
console.log(`  links added                ${stats.linksAdded}`);

if (samples.length > 0) {
  console.log("\nSample of what changes:\n");
  for (const sample of samples) {
    console.log(`  ${sample.title.slice(0, 76)}`);
    console.log(`    ${sample.before} link(s) → ${sample.links.length}`);
    for (const link of sample.links.slice(0, 4)) {
      console.log(`      • ${link.label.slice(0, 60)}  ${link.url.slice(0, 60)}`);
    }
    console.log("");
  }
}

if (!APPLY) console.log("Nothing was written. Re-run with --apply.");

/* ── Helpers ───────────────────────────────────────────────────────────── */

function valueOf(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (put it in .env.local)`);
  return value;
}

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
