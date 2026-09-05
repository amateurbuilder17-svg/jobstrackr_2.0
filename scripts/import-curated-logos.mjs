#!/usr/bin/env node
/**
 * Imports the curated conducting-body logo set in `logos/` and resolves each
 * image to the organisation rows it belongs to.
 *
 * ── What this is, and how it differs from the other logo script ────────────
 * `import-legacy-logos.mjs` carried 168 images out of the old project's bucket.
 * Its images were named by whoever saved them — `sail.png`, `iit-bhu.svg` — so
 * most of that script is the work of guessing which body a file name means, out
 * of a curated alias table.
 *
 * This set does not need guessing. It arrived with `logos_audit_report.csv`,
 * which states, per image, the body's full name and the classification an audit
 * pass gave it. So the matcher here is the same four rungs as the other script
 * — they were arrived at by watching wrong emblems land on cards, and none of
 * that reasoning changes — but the keys they match on come from a column rather
 * than from a file stem.
 *
 * Both scripts write `organizations.logo_path`, and they are meant to compose:
 * the legacy set covers 532 rows this set does not reach, and this set covers
 * ~300 the legacy one never did. See "Sharing the column" below for the rules
 * that keep them from fighting.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *
 *   node scripts/import-curated-logos.mjs                    # dry run + report
 *   node scripts/import-curated-logos.mjs --apply            # upload + write
 *   node scripts/import-curated-logos.mjs --report-matched | less
 *   node scripts/import-curated-logos.mjs --report-changed   # only the rewrites
 *   node scripts/import-curated-logos.mjs --report-unused    # images nothing used
 *
 * Re-running is safe and is the intended maintenance path: uploads upsert, and
 * `logo_path` is written only where it differs, so a run after a month of
 * ingestion gives the organisations created in that month their logos and
 * touches nothing else.
 *
 * Environment (in .env.local, or exported):
 *
 *   NEXT_PUBLIC_SUPABASE_URL     project URL
 *   SUPABASE_SECRET_KEY          service key — the bucket and the table are
 *                                both closed to the publishable one
 *
 * ── Sharing the column ─────────────────────────────────────────────────────
 * Two rules, and both exist because the other script was written when it was
 * the only writer:
 *
 *   1. This script never clears. `import-legacy-logos.mjs` clears rows it no
 *      longer matches, which is right for a sole owner and wrong for a second
 *      one — it would delete every assignment made here. That script now skips
 *      any row holding a path it did not itself upload; see the comment on its
 *      `cleared` list.
 *
 *   2. A weak match never displaces a logo a row already has. Rungs 92 and 95
 *      match on an acronym, and an acronym is the rung that goes wrong: "IIT
 *      (BHU) Varanasi" brackets BHU, and letting a 92 overwrite would have
 *      taken IIT BHU's own emblem off it and put the parent university's on.
 *      A row with no logo still takes a 92 — initials are the alternative
 *      there, and a parent body's mark beats initials.
 */

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ── Configuration ─────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const REPORT_MATCHED = args.includes("--report-matched");
const REPORT_CHANGED = args.includes("--report-changed");
const REPORT_UNUSED = args.includes("--report-unused");

const ROOT = resolve(import.meta.dirname, "..");
const LOGO_DIR = resolve(ROOT, "logos");
const AUDIT_CSV = resolve(ROOT, "logos_audit_report.csv");

/** Where images land in the bucket — the same namespace the legacy import
 *  writes to, deliberately. A curated image whose slug equals a legacy one is
 *  the same body under a better source, and overwriting it upgrades every row
 *  already pointing there without a single database write. */
const PREFIX = "organizations";

/** Rendered size, in pixels. The badge is 36 CSS px at its largest, so 128
 *  covers a 3× display and every file lands in single-digit kilobytes. */
const RENDER_PX = 128;

/** Below this a match is a guess, and a wrong emblem is worse than none:
 *  initials read as a placeholder, whereas the wrong crest reads as a fact
 *  about who is hiring. See `scoreLogo` for what each rung means. */
const MIN_SCORE = 90;

/** At or above this a match may overwrite an existing `logo_path`; below it,
 *  only fill an empty one. Rule 2 in the header. */
const OVERWRITE_SCORE = 95;

loadEnvLocal();

const SUPABASE_URL = required("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_KEY = required("SUPABASE_SECRET_KEY");

/* ── Normalisation, shared by both sides of the match ───────────────────── */

/** Strip to letters and digits, so punctuation, case and spacing stop being
 *  differences: "Bank of Baroda (BoB)" and "Bank of Baroda(BOB)" are one key. */
const norm = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const STOPWORDS = new Set(["and", "of", "the", "for", "in", "to", "on", "with", "by", "a"]);

const words = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/**
 * A name reduced to the words that carry identity, singularised.
 *
 * The plural matters: the audit calls a body "Indian Institute**s** of
 * Technology" where a listing says "Indian Institute of Technology Bombay", and
 * without this they are two unrelated phrases.
 */
const content = (value) =>
  words(value)
    .filter((w) => !STOPWORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));

/** "Airports Authority of India (AAI)" → "Airports Authority of India". */
const withoutTrailingAcronym = (name) =>
  name.replace(/\s*\([A-Za-z0-9&.\-/ ]{2,40}\)\s*$/, "").trim();

/** A body's name → the object name it is stored under. */
const slugify = (name) =>
  withoutTrailingAcronym(name)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/* ── Phase 1 · Read the audit ───────────────────────────────────────────── */

/**
 * A CSV reader rather than a dependency.
 *
 * The file has quoted fields — a body named "Bank of Baroda (BOB)" sits beside
 * a sector named "Banking & Finance", and one row's audit note contains a
 * comma — so `split(",")` mangles it. This is the whole of RFC 4180 that the
 * file actually uses: quotes, doubled quotes inside them, and CRLF.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = false;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const header = rows.shift();
  if (!header) throw new Error(`${AUDIT_CSV} is empty.`);

  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

/**
 * The keys and phrases each image answers to.
 *
 * Three keys per image, all from the audit's own `Name` and `Acronym` columns:
 * the name, the name with its trailing bracket removed, and the acronym. The
 * phrase — the name's content words — is what the prefix rung matches on, and
 * is the rung that does most of the work here, because a curated `Name` is a
 * full institutional name rather than a file stem.
 */
function buildProfiles(auditRows) {
  const files = new Map(readdirSync(LOGO_DIR).map((name) => [name, true]));

  const profiles = [];
  const missing = [];

  for (const row of auditRows) {
    const file = row.Saved_Filename;
    if (!file || !files.has(file)) {
      missing.push(`${row.ID} ${row.Name}`);
      continue;
    }

    const bare = withoutTrailingAcronym(row.Name);
    const keys = new Set([norm(row.Name), norm(bare), norm(row.Acronym)]);

    // Two characters name nothing. The audit's `Acronym` column holds "IN" for
    // the Indian Navy and "IB" for two different bodies, and "IN" is also what
    // falls out of the bracket in "…Authorisation Centre (IN-SPACe)" — which is
    // exactly how the Navy's ensign reached a space-regulation body.
    for (const key of [...keys]) if (key.length < 3) keys.delete(key);

    profiles.push({
      id: row.ID,
      name: row.Name,
      classification: row.Classification,
      file,
      path: `${PREFIX}/${slugify(row.Name)}.webp`,
      keys,
      phrase: content(bare),
      // One profile is one body, so a tie between two profiles is a genuine
      // ambiguity rather than a duplicate — unlike the legacy set, which holds
      // some bodies twice under two file names.
      body: `audit:${row.ID}`,
    });
  }

  if (missing.length > 0) {
    console.warn(`  ! ${missing.length} audit rows name a file that is not in logos/:`);
    for (const row of missing.slice(0, 10)) console.warn(`      ${row}`);
  }

  // ── Ambiguity ───────────────────────────────────────────────────────────
  // The audit's `Acronym` column is a short label, not an identifier: "MPSC"
  // is claimed by Maharashtra, Manipur, Meghalaya and Mizoram, "UPSC" by both
  // the Union commission and Uttarakhand's, "CBI" by Central Bank of India and
  // the Central Bureau of Investigation, and every IIT campus is filed under
  // "IIT". A key two bodies answer to identifies neither, so it is removed from
  // both rather than awarded to whichever the file listing put first.
  const owners = new Map();
  for (const p of profiles) {
    for (const key of p.keys) owners.set(key, (owners.get(key) ?? new Set()).add(p.body));
  }
  let dropped = 0;
  for (const p of profiles) {
    for (const key of p.keys) {
      if (owners.get(key).size > 1) {
        p.keys.delete(key);
        dropped++;
      }
    }
  }

  return { profiles, dropped };
}

/* ── Phase 2 · Normalise ────────────────────────────────────────────────── */

/**
 * Any image → a 128 px transparent WebP, whatever it arrived as.
 *
 * The folder is 43 MB across 241 files, displayed at 36 px. Resizing once here
 * makes the whole set a couple of megabytes and needs no image-transform
 * service at request time — which is a paid Supabase add-on, and a per-request
 * cost for a file that changes once a decade.
 *
 * Rasterising the 125 SVGs is the point rather than a cost: the bucket accepts
 * `image/webp` and nothing else, because it is public, and an SVG is a document
 * that can carry script which a public bucket will serve to anyone who opens
 * the object URL. `density` is what stops a vector rendering at its nominal
 * size and coming out blurred.
 *
 * Contain, not cover, on a transparent ground: these are emblems, and cropping
 * one to fill a square cuts the crest off. A wordmark four times as wide as it
 * is tall ends up letterboxed, which is what the badge expects.
 */
async function toWebp(sharp, buffer, name) {
  // 384 first, then the default. A vector whose nominal size is already large
  // — the Air Force ensign declares 4000 px — is multiplied by the density
  // before anything is resized, and sharp refuses the intermediate raster on
  // its input-pixel limit. Such a file has no detail to recover at 128 px
  // anyway, so the retry loses nothing; raising the limit instead would buy a
  // several-hundred-megabyte decode to throw all of it away.
  for (const density of [384, 72]) {
    try {
      return await sharp(buffer, { density })
        .resize(RENDER_PX, RENDER_PX, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
          withoutEnlargement: true,
        })
        .webp({ quality: 90 })
        .toBuffer();
    } catch (error) {
      if (density === 72) {
        console.warn(`  ! ${name}: ${error.message} — skipped`);
        return null;
      }
    }
  }
  return null;
}

/* ── Phase 3 · Resolve an image to organisations ────────────────────────── */

/**
 * The contents of the *first* bracketed group in a name, if there is one.
 *
 * Only the first, and that rule keeps a joint venture from wearing its parent's
 * badge. "Hindustan Urvarak & Rasayan Limited (HURL) - a joint venture of
 * Indian Oil Corporation Limited (IOCL)…" brackets two bodies: the first is
 * what the listing calls itself, the second is who it mentions.
 */
function firstParenthetical(name) {
  const match = /\(([^)]{2,40})\)/.exec(name);
  return match ? [match[1]] : [];
}

/**
 * The tokens by which a listing names itself: its leading word, and anything
 * inside its first bracket.
 *
 * Three characters minimum, not two. A two-letter token is as likely to be a
 * word as an acronym, and the audit has two-letter acronyms to collide with.
 */
function selfNamingTokens(name) {
  const ACRONYM_RE = /^[A-Z][A-Za-z0-9]{2,7}$/;
  const out = [];

  const first = name.split(/[^A-Za-z0-9]+/)[0] ?? "";
  if (first === first.toUpperCase() && ACRONYM_RE.test(first)) out.push(first);

  for (const group of firstParenthetical(name)) {
    for (const token of group.split(/[^A-Za-z0-9]+/)) {
      if (token === token.toUpperCase() && ACRONYM_RE.test(token)) out.push(token);
    }
  }
  return out;
}

/**
 * How well an organisation name matches an image.
 *
 *   100  the name is the image's name, or its acronym, exactly
 *    95  its own first bracket names the image — "…Research (IISER Pune)"
 *    92  it opens with, or first-brackets, the image's acronym — "(CSIR CFTRI)"
 *  90+n  the name *begins* with the image's n-word name — "AIIMS Bhopal"
 *
 * Every rung anchors on something the listing states about *itself*, and each
 * is here because a looser version put a wrong emblem on a card. The reasoning
 * is set out at length in `import-legacy-logos.mjs`; the short form:
 *
 * **Set membership** — every word of the image's name appearing anywhere in the
 * organisation's — gave the Indian Institute of Science's crest to the Indian
 * Institute of Engineering Science and Technology. Contiguity is what makes a
 * phrase a name rather than a bag of common words.
 *
 * **The phrase anywhere in the name** handed one Public Service Commission's
 * seal to 47 state ones. A qualifier in front of an institutional phrase
 * usually means a different institution, so only a match at the *start* counts.
 *
 * **An acronym token anywhere** collected commissions for "Indian Navy SSC
 * Officer", where SSC is Short Service Commission. An acronym is the body
 * naming itself only when it opens the string or sits in brackets; mid-sentence
 * it is prose. That restriction is what lets this rung outrank a phrase match,
 * which it must: "…Science Education and Research (IISER Pune)" opens with the
 * Indian Institute of Science's name and is not that institute.
 */
function scoreLogo(profile, org) {
  if (
    profile.keys.has(norm(org.name)) ||
    profile.keys.has(norm(withoutTrailingAcronym(org.name)))
  ) {
    return 100;
  }

  for (const group of firstParenthetical(org.name)) {
    if (profile.keys.has(norm(group))) return 95;
  }

  for (const token of selfNamingTokens(org.name)) {
    if (profile.keys.has(norm(token))) return 92;
  }

  const orgWords = content(org.name);
  let best = 0;
  for (const phrase of [profile.phrase]) {
    if (phrase.length > 0 && phrase.every((w, k) => orgWords[k] === w)) {
      // Longer phrase wins: "IIM Bodh Gaya" should not settle for an image
      // whose whole name is "IIM".
      best = Math.max(best, 90 + phrase.length);
    }
  }
  return best;
}

/* ── Supabase, over REST ────────────────────────────────────────────────── */

const authHeaders = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

async function fetchOrganizations() {
  const out = [];
  const step = 1000;
  for (let from = 0; ; from += step) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/organizations?select=id,slug,name,logo_path&order=slug&offset=${from}&limit=${step}`,
      { headers: authHeaders },
    );
    if (!res.ok) throw new Error(`organizations: ${res.status} ${await res.text()}`);
    const page = await res.json();
    out.push(...page);
    if (page.length < step) return out;
  }
}

async function upload(path, body) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/logos/${path}`, {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "image/webp",
      // A logo changes when a body redesigns it, which is a once-a-decade
      // event, so a long immutable cache is free. `upsert` is what makes a
      // re-run idempotent rather than a 409.
      "Cache-Control": "public, max-age=31536000, immutable",
      "x-upsert": "true",
    },
    body,
  });
  if (!res.ok) throw new Error(`upload ${path}: ${res.status} ${await res.text()}`);
}

/**
 * Writes `logo_path`, one request per distinct image.
 *
 * PATCH rather than upsert: an upsert has to send every not-null column, and a
 * typo in that list would rewrite `name` on 3,700 rows. This can only ever
 * touch the one column it names, on ids that came out of the table a moment
 * ago. Grouping by path turns ~600 row updates into ~130 requests.
 */
async function writeLogoPaths(updates) {
  const byPath = new Map();
  for (const u of updates) byPath.set(u.logo_path, [...(byPath.get(u.logo_path) ?? []), u.id]);

  let done = 0;
  for (const [path, ids] of byPath) {
    // URLs have a length limit and these are uuids; 200 ids is ~7.5 kB.
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/organizations?id=in.(${batch.join(",")})`,
        {
          method: "PATCH",
          headers: {
            ...authHeaders,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ logo_path: path }),
        },
      );
      if (!res.ok) throw new Error(`update: ${res.status} ${await res.text()}`);
      done += batch.length;
      process.stdout.write(`\r   wrote ${done}/${updates.length}`);
    }
  }
  process.stdout.write("\n");
}

/* ── Main ───────────────────────────────────────────────────────────────── */

async function main() {
  const { default: sharp } = await import("sharp");

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — curated logo import\n`);

  const auditRows = parseCsv(readFileSync(AUDIT_CSV, "utf8"));
  const { profiles, dropped } = buildProfiles(auditRows);
  console.log(`1. Audit: ${auditRows.length} rows, ${profiles.length} with an image on disk`);
  console.log(`   ${dropped} keys dropped as ambiguous — two bodies answered to them`);

  const byClass = new Map();
  for (const p of profiles)
    byClass.set(p.classification, (byClass.get(p.classification) ?? 0) + 1);
  for (const [name, count] of [...byClass].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(count).padStart(4)}  ${name}`);
  }

  // Two audit rows whose names slugify the same would silently overwrite one
  // another in the bucket, and the second one's body would wear the first's
  // emblem. Nothing in the current file does this; it is checked because a row
  // added later could.
  const claimants = new Map();
  for (const p of profiles) claimants.set(p.path, [...(claimants.get(p.path) ?? []), p.name]);
  for (const [path, names] of claimants) {
    if (names.length > 1) console.warn(`  ! path collision ${path}: ${names.join(" | ")}`);
  }

  // ── Normalise and upload ────────────────────────────────────────────────
  let bytesIn = 0;
  let bytesOut = 0;
  const uploaded = new Map(); // profile.id → storage path

  console.log(`\n2. Normalising to ${RENDER_PX}px WebP${APPLY ? " and uploading" : ""}`);
  for (const profile of profiles) {
    const original = readFileSync(resolve(LOGO_DIR, profile.file));
    const webp = await toWebp(sharp, original, profile.file);
    if (!webp) continue;

    bytesIn += original.length;
    bytesOut += webp.length;

    if (APPLY) await upload(profile.path, webp);
    uploaded.set(profile.id, profile.path);
  }
  console.log(
    `   ${uploaded.size} objects · ${mb(bytesIn)} → ${mb(bytesOut)} ` +
      `(${Math.round((1 - bytesOut / bytesIn) * 100)}% smaller)`,
  );

  // ── Resolve ─────────────────────────────────────────────────────────────
  const organizations = await fetchOrganizations();
  console.log(`\n3. Resolving against ${organizations.length} organisations`);

  const updates = [];
  const assignments = [];
  const reach = new Map(); // storage path → organisation names
  let held = 0;
  let ambiguous = 0;

  for (const org of organizations) {
    // A tie is an answer too, and the answer is "no". Six IISER campuses score
    // identically on their family name — picking whichever was listed first
    // would put Pune's crest on Kolkata's jobs, which is a wrong logo wearing
    // the confidence of a right one.
    let bestScore = 0;
    let contenders = new Map(); // storage path → body

    for (const profile of profiles) {
      const path = uploaded.get(profile.id);
      if (!path) continue;
      const score = scoreLogo(profile, org);
      if (score === 0 || score < bestScore) continue;
      if (score > bestScore) {
        bestScore = score;
        contenders = new Map();
      }
      contenders.set(path, profile.body);
    }

    if (bestScore < MIN_SCORE || contenders.size === 0) continue;

    if (new Set(contenders.values()).size > 1) {
      ambiguous++;
      continue;
    }

    const path = [...contenders.keys()].sort()[0];

    // Rule 2 in the header: an acronym-rung match may fill an empty column but
    // may not overwrite a logo some other pass already resolved.
    if (org.logo_path && org.logo_path !== path && bestScore < OVERWRITE_SCORE) {
      held++;
      continue;
    }

    reach.set(path, [...(reach.get(path) ?? []), org.name]);
    assignments.push({ name: org.name, path, score: bestScore, had: org.logo_path });
    if (org.logo_path !== path) updates.push({ id: org.id, logo_path: path, name: org.name });
  }

  const changed = assignments.filter((a) => a.had && a.had !== a.path);
  const already = organizations.filter((o) => o.logo_path).length;
  const after = new Set([
    ...organizations.filter((o) => o.logo_path).map((o) => o.id),
    ...updates.map((u) => u.id),
  ]).size;

  console.log(
    `   ${assignments.length} organisations matched, ` +
      `${reach.size} of ${uploaded.size} images used`,
  );
  console.log(`   ${updates.length - changed.length} rows gain a logo they did not have`);
  console.log(`   ${changed.length} rows move to a more specific image`);
  console.log(`   ${held} weak matches held back — the row already has a logo`);
  console.log(`   ${ambiguous} left alone because two images tied`);
  console.log(`\n   Coverage: ${already} → ${after} of ${organizations.length} organisations`);

  console.log("\n   Images by reach:");
  for (const [path, names] of [...reach]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 15)) {
    console.log(
      `     ${String(names.length).padStart(4)}  ${path.replace(`${PREFIX}/`, "").padEnd(52)}` +
        `  ·  ${names.slice(0, 2).join(" | ").slice(0, 70)}`,
    );
  }

  if (REPORT_MATCHED) {
    console.log(`\n   Matched (${assignments.length}):`);
    for (const a of assignments) {
      console.log(`     ${a.score}  ${a.path.replace(`${PREFIX}/`, "").padEnd(52)}  ${a.name}`);
    }
  }

  if (REPORT_CHANGED) {
    // The review surface that matters most: every one of these takes an emblem
    // off a card that already had one, so a bad rule shows up here as a row
    // whose new image plainly is not the body named beside it.
    console.log(`\n   Moving to a different image (${changed.length}):`);
    for (const a of changed) {
      console.log(
        `     ${a.score}  ${a.had.replace(`${PREFIX}/`, "").padEnd(44)} → ` +
          `${a.path.replace(`${PREFIX}/`, "").padEnd(52)}  ${a.name.slice(0, 50)}`,
      );
    }
  }

  if (REPORT_UNUSED) {
    // Mostly expected: the audit covers every state's transport corporation and
    // electricity board under a generic name no listing uses. An image here
    // that names a body with listings is a matching gap worth a rule.
    const unused = profiles.filter((p) => !reach.has(p.path));
    console.log(`\n   Images nothing matched (${unused.length}):`);
    for (const p of unused) console.log(`     ${p.classification.padEnd(22)}  ${p.name}`);
  }

  if (!APPLY) {
    console.log("\nDry run — nothing uploaded, nothing written. Re-run with --apply.");
    return;
  }

  console.log(`\n4. Writing logo_path on ${updates.length} rows`);
  await writeLogoPaths(updates);
  console.log("   done");
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. See the header of this file.`);
    process.exit(1);
  }
  return value;
}

function loadEnvLocal() {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = readFileSync(resolve(ROOT, file), "utf8");
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

await main();
