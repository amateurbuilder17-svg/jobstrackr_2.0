#!/usr/bin/env node
/**
 * Collapses organisations that are one body stored several times.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * 850 of the 3,963 rows in `organizations` are a strict extension of another
 * row's name: `PSPCL`, `PSPCL ALM`, `PSPCL Assistant Lineman` and `PSPCL JE`
 * are one employer stored four times. The feed sends the role welded to the
 * body, and ingestion used to create anything it did not recognise.
 *
 * That is not cosmetic. A split body splits its listings across two pages, two
 * filters and two logos, and every one of those pages is thinner than the one
 * page should have been.
 *
 * `resolveOrganizations` no longer creates these — see the extension check
 * there — so this is the one-off that clears what was already written.
 *
 * ── What it does to a duplicate ────────────────────────────────────────────
 * Re-points every reference, records the duplicate's slug as an alias on the
 * survivor so the spelling still resolves, then deletes the row. The alias
 * matters: without it, the next feed row saying `PSPCL JE` would have nothing
 * to match and would create the duplicate again.
 *
 * Order is forced by the constraints. `jobs.organization_id` and
 * `exams.organization_id` are `on delete restrict`, so a delete before the
 * re-point fails outright — which is the safe direction, but only if the
 * re-point is checked rather than assumed.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *
 *   node scripts/merge-duplicate-organizations.mjs           # dry run
 *   node scripts/merge-duplicate-organizations.mjs --apply
 *
 * Run this BEFORE `backfill-org-aliases.mjs`: collapsing first means the
 * acronyms land on one row each rather than being split across duplicates,
 * where they would be ambiguous and therefore ignored.
 *
 * Environment: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const apply = process.argv.includes("--apply");

function env() {
  const out = { ...process.env };
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !out[m[1]]) out[m[1]] = m[2].trim();
    }
  } catch {
    /* exported instead */
  }
  return out;
}

const E = env();
for (const key of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"]) {
  if (!E[key]) {
    console.error(`missing ${key}`);
    process.exit(1);
  }
}

const db = createClient(E.NEXT_PUBLIC_SUPABASE_URL, E.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false },
});

const orgs = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from("organizations")
    .select("id, slug, name, aliases")
    .range(from, from + 999);

  if (error) {
    console.error(`read: ${error.message}`);
    process.exit(1);
  }
  orgs.push(...data);
  if (data.length < 1000) break;
}

const bySlug = new Map(orgs.map((o) => [o.slug, o]));

/**
 * The longest body this name extends, or nothing.
 *
 * Longest wins so `pspcl-assistant-lineman` collapses into `pspcl-assistant`
 * when that exists, rather than skipping past it to `pspcl` — the nearer parent
 * is the more specific true statement, and a chain resolves itself over
 * successive runs.
 */
function parentOf(slug) {
  const words = slug.split("-");
  for (let n = words.length - 1; n >= 1; n -= 1) {
    const stem = words.slice(0, n).join("-");
    if (bySlug.has(stem)) return bySlug.get(stem);
  }
  return null;
}

/**
 * The body at the end of the chain, not the next one along.
 *
 * `hindustan-aeronautics-limited-hal-aircraft-division-nasik` extends
 * `…-hal`, which itself extends `hindustan-aeronautics-limited`. Merging into
 * the immediate parent means merging into a row this same run is about to
 * delete, and the re-point then fails its foreign key — which is exactly how 76
 * of the first 867 failed. Following the chain to a row that is nobody's
 * duplicate is the whole fix.
 */
function rootOf(slug) {
  const seen = new Set([slug]);
  let current = slug;

  for (;;) {
    const parent = parentOf(current);
    // A cycle cannot happen with strict prefixes, but a guard costs nothing and
    // an infinite loop mid-merge would be an ugly way to find out otherwise.
    if (!parent || seen.has(parent.slug)) return bySlug.get(current);
    seen.add(parent.slug);
    current = parent.slug;
  }
}

const merges = [];
for (const org of orgs) {
  const root = rootOf(org.slug);
  if (root && root.id !== org.id) merges.push({ from: org, into: root });
}

console.log(`organizations: ${orgs.length}`);
console.log(`  duplicates to collapse: ${merges.length}`);
for (const m of merges.slice(0, 6)) {
  console.log(`    ${m.from.slug.slice(0, 46).padEnd(48)} → ${m.into.slug}`);
}

if (merges.length === 0) process.exit(0);

if (!apply) {
  console.log("\n  dry run — nothing changed. Re-run with --apply.");
  process.exit(0);
}

let merged = 0;
let failed = 0;

for (const { from, into } of merges) {
  // Re-point first. `on delete restrict` means a missed reference stops the
  // delete rather than orphaning anything, but a checked re-point is how the
  // failure gets reported instead of discovered later.
  let blocked = false;
  for (const table of ["jobs", "exam_updates", "exams"]) {
    const { error } = await db
      .from(table)
      .update({ organization_id: into.id })
      .eq("organization_id", from.id);

    if (error) {
      console.error(`  ${from.slug}: repointing ${table}: ${error.message}`);
      blocked = true;
    }
  }

  if (blocked) {
    failed += 1;
    continue;
  }

  // The duplicate's own spelling becomes a way of saying the survivor's name,
  // so the next feed row using it resolves instead of recreating this row.
  const aliases = new Set([
    ...(Array.isArray(into.aliases) ? into.aliases : []),
    ...(Array.isArray(from.aliases) ? from.aliases : []),
    from.slug,
  ]);

  const { error: aliasError } = await db
    .from("organizations")
    .update({ aliases: [...aliases] })
    .eq("id", into.id);

  if (aliasError) {
    console.error(`  ${from.slug}: alias: ${aliasError.message}`);
    failed += 1;
    continue;
  }

  const { error: deleteError } = await db.from("organizations").delete().eq("id", from.id);

  if (deleteError) {
    console.error(`  ${from.slug}: delete: ${deleteError.message}`);
    failed += 1;
    continue;
  }

  merged += 1;
}

console.log(`\nmerged: ${merged}, failed: ${failed}`);
