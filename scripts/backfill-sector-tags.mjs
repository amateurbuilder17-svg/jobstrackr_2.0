#!/usr/bin/env node
/**
 * Rewrites `jobs.tags` and `exam_updates.tags` from `sectorTagsOf`.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The column was carrying the output of the previous project's `generateTags`,
 * which scored keywords with `text.includes(keyword)`. Unanchored substring
 * matching over government prose does not misfire occasionally; it misfires
 * structurally:
 *
 *   "lic"  ⊂ pub**lic** / po**lic**e / app**lic**ation → 59 rows `insurance`
 *   "nda"  ⊂ seco**nda**ry / sta**nda**rd              → 46 `upsc`, 48 `defence`
 *   "psc"  ⊂ u**psc**                                  → UPSC exams `state_psc`
 *   "bel"  ⊂ **bel**ow                                 → `psu`
 *   "rrb"  ⊂ IBPS **RRB** PO (Regional Rural *Bank*)   → `railway` on a bank exam
 *
 * and the vocabulary it emitted — `12th_pass`, `group_c`, `state_psc` — is not
 * the `SECTORS` vocabulary, which is the only one the sector chips on /jobs and
 * `profiles.preferred_sectors` can match. So the column was simultaneously
 * wrong and unreadable: 129 rows of bad tags out of 6,821, and three sector
 * chips that could never return anything.
 *
 * ── What it writes ─────────────────────────────────────────────────────────
 * `tags` and nothing else, from the title and the employer name, through the
 * app's own `sectorTagsOf` — the same function ingestion now calls, so a
 * backfilled row and a freshly ingested one cannot disagree.
 *
 * `content_hash` is deliberately left alone. It was computed over the old tags,
 * so the next sync run sees a mismatch and rewrites those rows once with the
 * same values this script wrote. That is a one-time no-op write on the rows the
 * feed still carries, and it is cheaper than reproducing the whole ingest
 * payload here just to keep a hash in step.
 *
 * ── exam_updates ───────────────────────────────────────────────────────────
 * The same column on the updates table was unusable in both shapes it arrived
 * in: 5,978 of 6,173 rows held the literal string "[]" — an array the sheet's
 * enrichment wrote without joining, which comma-splitting turned into a single
 * tag, rendered as a badge reading "[]" on every one of those pages — and the
 * ~180 rows holding anything real held SEO keyword phrases ("Latest NTPC
 * Jobs"), 751 distinct values across them. Neither groups anything, and
 * neither is the vocabulary `jobs.tags` speaks.
 *
 * Usage:
 *
 *   node scripts/backfill-sector-tags.mjs                    # dry run, both
 *   node scripts/backfill-sector-tags.mjs --apply
 *   node scripts/backfill-sector-tags.mjs --table jobs       # one table only
 *   node scripts/backfill-sector-tags.mjs --backup t.json    # save current tags
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

/* ── Resolving the app's modules from a plain script ────────────────────── */

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

const { sectorTagsOf } = await import("../src/lib/jobs/sectors.ts");

/* ── Configuration ─────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const BACKUP = valueOf("--backup");

/**
 * Both tables carry the same column, filled by the same function, so they are
 * backfilled by the same pass rather than by two scripts that could drift.
 */
const TABLES = ["jobs", "exam_updates"];
const ONLY = valueOf("--table");
if (ONLY && !TABLES.includes(ONLY)) {
  throw new Error(`--table must be one of ${TABLES.join(", ")}`);
}

/** Rows per read. Four small text columns, so this is a modest response. */
const READ_CHUNK = 500;
/**
 * Ids per write. Rows are grouped by the tag array they are getting, so one
 * PATCH sets one array on up to this many rows — ~70 requests for the table,
 * rather than one per row. Chunked because `id=in.(…)` goes in the URL.
 */
const WRITE_CHUNK = 100;

loadEnvLocal();

const URL_BASE = required("NEXT_PUBLIC_SUPABASE_URL");
const KEY = required("SUPABASE_SECRET_KEY");

/* ── Read ──────────────────────────────────────────────────────────────── */

/** The keyset seed. `id` is a uuid, and `gt.""` is a 22P02 from Postgres. */
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

async function* readRows(table) {
  let after = NIL_UUID;

  for (;;) {
    // Keyset on the primary key, not OFFSET, which gets slower every page.
    // `organizations(...)` is an embed, so the employer name arrives with the
    // row instead of costing a second query per organisation.
    const url =
      `${URL_BASE}/rest/v1/${table}` +
      `?select=id,title,tags,organizations(name,short_name)` +
      `&id=gt.${encodeURIComponent(after)}&order=id.asc&limit=${READ_CHUNK}`;

    const response = await fetch(url, { headers: authHeaders() });
    if (!response.ok)
      throw new Error(`read ${table}: ${response.status} ${await response.text()}`);

    const rows = await response.json();
    if (rows.length === 0) return;
    for (const row of rows) yield row;
    after = rows[rows.length - 1].id;
  }
}

/* ── Write ─────────────────────────────────────────────────────────────── */

/**
 * One tag array onto many rows.
 *
 * PATCH rather than a bulk upsert: an upsert against `jobs` would have to carry
 * every not-null column of a table this script has no business rewriting.
 */
async function writeTags(table, ids, tags) {
  const url = `${URL_BASE}/rest/v1/${table}?id=in.(${ids.join(",")})`;
  const response = await fetch(url, {
    method: "PATCH",
    headers: { ...authHeaders(), "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({ tags }),
  });
  if (!response.ok)
    throw new Error(`write jobs.tags: ${response.status} ${await response.text()}`);
}

/* ── Run ───────────────────────────────────────────────────────────────── */

const backup = [];

for (const table of TABLES) {
  if (ONLY && table !== ONLY) continue;

  const stats = {
    seen: 0,
    changed: 0,
    unchanged: 0,
    cleared: 0,
    gained: 0,
    before: 0,
    after: 0,
  };
  const perTag = new Map();
  /** Rows to write, grouped by the tag array they are getting. */
  const groups = new Map();

  for await (const row of readRows(table)) {
    stats.seen += 1;

    const current = row.tags ?? [];
    const next = sectorTagsOf({
      title: row.title,
      organization: row.organizations?.name ?? null,
      shortName: row.organizations?.short_name ?? null,
    });

    if (current.length > 0) stats.before += 1;
    if (next.length > 0) stats.after += 1;
    for (const tag of next) perTag.set(tag, (perTag.get(tag) ?? 0) + 1);
    if (BACKUP) backup.push({ table, id: row.id, tags: current });

    if (same(current, next)) {
      stats.unchanged += 1;
      continue;
    }

    stats.changed += 1;
    if (current.length > 0 && next.length === 0) stats.cleared += 1;
    if (current.length === 0 && next.length > 0) stats.gained += 1;

    const key = next.join(",");
    if (!groups.has(key)) groups.set(key, { tags: next, ids: [] });
    groups.get(key).ids.push(row.id);
  }

  let written = 0;
  if (APPLY) {
    for (const { tags, ids } of groups.values()) {
      for (let i = 0; i < ids.length; i += WRITE_CHUNK) {
        await writeTags(table, ids.slice(i, i + WRITE_CHUNK), tags);
        written += Math.min(WRITE_CHUNK, ids.length - i);
        process.stdout.write(`\r  ${table}: ${written} rows written…`);
      }
    }
    process.stdout.write("\r");
  }

  console.log(`\n${APPLY ? "Applied" : "Dry run"} — ${table}, ${stats.seen} rows read\n`);
  console.log(`  changed    ${stats.changed}`);
  console.log(`  unchanged  ${stats.unchanged}`);
  console.log(`  gained tags where there were none   ${stats.gained}`);
  console.log(`  cleared tags that matched no sector ${stats.cleared}`);
  console.log(`\n  rows carrying tags: ${stats.before} → ${stats.after}`);
  console.log(`  writes: ${groups.size} distinct tag sets\n`);
  for (const [tag, count] of [...perTag].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${tag.padEnd(14)} ${String(count).padStart(5)}`);
  }
}

if (BACKUP) {
  writeFileSync(BACKUP, JSON.stringify(backup));
  console.log(`\nBacked up ${backup.length} rows of current tags → ${BACKUP}`);
}
if (!APPLY) console.log("\nNothing was written. Re-run with --apply.");

/* ── Helpers ───────────────────────────────────────────────────────────── */

function same(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
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
