#!/usr/bin/env node
/**
 * Mines the acronym each organisation already carries in its own name.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * 1,039 of the 3,963 rows in `organizations` are named like `National Aluminium
 * Company Limited (NALCO)`. The acronym is the string the feed's titles
 * actually use — "NALCO Non-Executive Recruitment 2026" — and until it is a
 * lookup key, that job cannot find its employer.
 *
 * The table was designed for this. `organizations.aliases` is commented
 * "alternate spellings seen in scraped listings, used to resolve an incoming
 * department string to this row"; nothing ever wrote to it.
 *
 * Measured over the 55 jobs the live feed carries with no usable organisation:
 * matching the title's leading words against known names recovers 22, and
 * adding these acronyms recovers a further 19 — 41 of 55. Initialism matching
 * and searching for a known name anywhere in the title each added nothing on
 * top, which is why neither is here.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *
 *   node scripts/backfill-org-aliases.mjs            # dry run: counts only
 *   node scripts/backfill-org-aliases.mjs --apply
 *
 * Re-running is safe and idempotent: a row whose alias is already present is
 * left alone, and `short_name` is only ever filled when empty — never
 * overwritten, because a human-curated one is better than a parsed one.
 *
 * Environment (from .env.local, or exported):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY
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
    // Exported into the environment instead. Fine.
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

/** Mirrors `toSlug` closely enough for a lookup key. */
const slugify = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * The bracketed acronym, if the brackets hold one.
 *
 * Bounded at 12 characters: a longer bracketed phrase is a qualifier — "(New
 * Delhi)", "(Recruitment Cell)" — and turning those into lookup keys would file
 * every Delhi body under one another.
 */
function acronymOf(name) {
  const m = /\(([A-Za-z][A-Za-z.&-]{1,11})\)/.exec(String(name ?? ""));
  if (!m) return null;
  const slug = slugify(m[1]);
  return slug.length >= 2 ? slug : null;
}

const rows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await db
    .from("organizations")
    .select("id, name, short_name, aliases")
    .range(from, from + 999);

  if (error) {
    console.error(`read: ${error.message}`);
    process.exit(1);
  }
  rows.push(...data);
  if (data.length < 1000) break;
}

const updates = [];
for (const org of rows) {
  const acronym = acronymOf(org.name);
  if (!acronym) continue;

  const aliases = Array.isArray(org.aliases) ? org.aliases : [];
  const patch = {};

  if (!aliases.includes(acronym)) patch.aliases = [...aliases, acronym];
  // Only when empty. A curated short name outranks one parsed out of brackets.
  if (!org.short_name) patch.short_name = acronym.toUpperCase();

  if (Object.keys(patch).length > 0) updates.push({ id: org.id, name: org.name, patch });
}

console.log(`organizations: ${rows.length}`);
console.log(`  carrying a bracketed acronym: ${rows.filter((o) => acronymOf(o.name)).length}`);
console.log(`  needing an update           : ${updates.length}`);
for (const u of updates.slice(0, 5)) {
  console.log(`    ${String(u.name).slice(0, 52).padEnd(54)} → ${JSON.stringify(u.patch)}`);
}

if (!apply) {
  console.log("\n  dry run — nothing written. Re-run with --apply.");
  process.exit(0);
}

let written = 0;
let failed = 0;
for (const u of updates) {
  const { error } = await db.from("organizations").update(u.patch).eq("id", u.id);
  if (error) {
    failed += 1;
    console.error(`  ${u.name}: ${error.message}`);
  } else {
    written += 1;
  }
}

console.log(`\nwritten: ${written}, failed: ${failed}`);
