#!/usr/bin/env node
/**
 * Moves the old project's conducting-body logos into this one, and resolves
 * each to an organisation row — once, here, instead of on every render.
 *
 * The old app kept 168 images in `logos/conducting-bodies/` on the old Supabase
 * project and matched them to a job's free-text `department` string in the
 * browser: a 13 kB lookup table, an O(n) scan per card, a memo cache to make
 * that bearable, and a `Building2` icon whenever it missed — which was most of
 * the long tail. `organizations.logo_path` exists so that work happens once and
 * its answer is stored. This script is that once.
 *
 * Three phases, in order:
 *
 *   1. FETCH      list and download the old bucket
 *   2. NORMALISE  128 px WebP, transparent, via sharp
 *   3. RESOLVE    match each image to organisation rows, write `logo_path`
 *
 * Usage:
 *
 *   node scripts/import-legacy-logos.mjs                 # dry run + report
 *   node scripts/import-legacy-logos.mjs --apply         # upload + write
 *   node scripts/import-legacy-logos.mjs --report-matched | less
 *   node scripts/import-legacy-logos.mjs --report-unmatched
 *
 * Re-running is safe and is the intended maintenance path: uploads upsert, and
 * `logo_path` is only written where it differs, so a run after a week of
 * ingestion gives the organisations created in that week their logos and
 * touches nothing else.
 *
 * Environment (in .env.local, or exported):
 *
 *   NEXT_PUBLIC_SUPABASE_URL     this project
 *   SUPABASE_SECRET_KEY          this project's service key
 *   LEGACY_SUPABASE_URL          the old project
 *   LEGACY_SUPABASE_SERVICE_KEY  the old project's service-role key
 *
 * ## Why the matching lives here and not in the ingest path
 *
 * Ingestion creates an organisation from whatever string the feed carried, at a
 * rate of a few a week. Matching 168 images against 3,744 names is a scan; doing
 * it inside the hourly sync would spend that scan on every run to discover the
 * two rows that changed. Running it here, deliberately, also means the match
 * quality is reviewable — the dry run prints every assignment it intends to
 * make, and a bad rule shows up in that list before it reaches a card.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ── Configuration ─────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const REPORT_MATCHED = args.includes("--report-matched");
const REPORT_UNMATCHED = args.includes("--report-unmatched");

/** Where images land in the new bucket. The old prefix was
 *  `conducting-bodies/`; the table these hang off is `organizations`, and a
 *  path that names a different concept than its column is how a future reader
 *  ends up assuming there are two kinds of logo. */
const PREFIX = "organizations";

/** Rendered size, in pixels. The badge is 36 CSS px at its largest, so 128
 *  covers a 3× display with room to spare and every file lands under 15 kB. */
const RENDER_PX = 128;

/** Below this score a match is a guess, and a wrong logo is worse than no logo:
 *  initials are obviously a placeholder, whereas the wrong emblem reads as a
 *  fact about who is hiring. See `scoreLogo` for what each level means. */
const MIN_SCORE = 90;

loadEnvLocal();

const NEW_URL = required("NEXT_PUBLIC_SUPABASE_URL");
const NEW_KEY = required("SUPABASE_SECRET_KEY");
const OLD_URL = required("LEGACY_SUPABASE_URL");
const OLD_KEY = required("LEGACY_SUPABASE_SERVICE_KEY");

/* ── Normalisation, shared by both sides of the match ───────────────────── */

/** The old app's `normalizeOrganizationKey`, unchanged: strip to letters and
 *  digits so punctuation, case and spacing stop being differences. */
const norm = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const STOPWORDS = new Set(["and", "of", "the", "for", "in", "to", "on", "with", "by", "a"]);

const words = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** "staff selection commission" → "ssc". Stopwords are dropped, so "Board of
 *  Secondary Education" gives BSE rather than BOSE. */
const acronym = (list) =>
  list
    .filter((w) => !STOPWORDS.has(w))
    .map((w) => w[0])
    .join("");

/** Suffixes that are part of a file name, not part of a body's name. */
const FILE_SUFFIX_RE = /[-_ ]?(logo|icon|img|image|emblem|seal|badge|crest)s?$/i;

/* ── Phase 1 · Read the old bucket ──────────────────────────────────────── */

async function listLegacyLogos() {
  const res = await fetch(`${OLD_URL}/storage/v1/object/list/logos`, {
    method: "POST",
    headers: {
      apikey: OLD_KEY,
      Authorization: `Bearer ${OLD_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prefix: "conducting-bodies/",
      limit: 1000,
      sortBy: { column: "name", order: "asc" },
    }),
  });

  if (!res.ok) throw new Error(`list: ${res.status} ${await res.text()}`);

  const files = await res.json();
  return files.filter(
    (f) => f.name !== ".emptyFolderPlaceholder" && /\.(png|jpe?g|webp|svg)$/i.test(f.name),
  );
}

async function downloadLegacyLogo(name) {
  const res = await fetch(
    `${OLD_URL}/storage/v1/object/logos/conducting-bodies/${encodeURIComponent(name)}`,
    { headers: { apikey: OLD_KEY, Authorization: `Bearer ${OLD_KEY}` } },
  );
  if (!res.ok) throw new Error(`download ${name}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/* ── Phase 2 · Normalise ────────────────────────────────────────────────── */

/**
 * Every image becomes a 128 px transparent WebP, whatever it arrived as.
 *
 * The old bucket is 3.0 MB across 168 files and the single largest is a 778 kB
 * JPEG of the RBI seal — displayed, in both apps, at 36 px. The old app papered
 * over that with Supabase's `/render/image/` CDN transform, which is a paid
 * add-on and a per-request cost for a file that never changes. Resizing once at
 * import makes the whole set about 1 MB and needs no transform service at all.
 *
 * Rasterising the four SVGs is a bonus rather than a loss: it is what lets the
 * bucket refuse `image/svg+xml`, and an SVG served from a public bucket is a
 * document that can carry script.
 */
async function toWebp(sharp, buffer, name) {
  try {
    return await sharp(buffer, { density: 384 })
      .resize(RENDER_PX, RENDER_PX, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
        withoutEnlargement: true,
      })
      .webp({ quality: 90 })
      .toBuffer();
  } catch (error) {
    console.warn(`  ! ${name}: ${error.message} — skipped`);
    return null;
  }
}

/* ── Phase 3 · Resolve an image to organisations ────────────────────────── */

/**
 * Images the old bucket names misleadingly. Each was opened and looked at.
 *
 * `public-service-commission.jpg` is not a generic commission mark: it is the
 * Union PSC's emblem, wordmark and all, and the same image is in the bucket a
 * second time under an honest name. The old alias table has it down as generic
 * — its aliases are "State PSC", "UPPSC", "WBPSC" — which is how Delhi's seal
 * ended up on Goa's and Kerala's commissions. Dropping the file loses nothing:
 * `union-public-service-commission-upsc` still covers the body it belongs to.
 */
const SKIP = new Set(["public-service-commission"]);

/**
 * The keys and phrases an image answers to.
 *
 * A file name alone is thin — `sail.png` would never meet "Steel Authority of
 * India Limited" — so the old app's curated alias table is folded in here.
 * That table is the one piece of the old client-side hook worth keeping; it
 * encodes which acronym belongs to which body, which nothing derives from a
 * string.
 *
 * ## Families
 *
 * Its entries are per *body*, and a third of this bucket is campuses: 17 IIMs,
 * 20 IITs, 6 IISERs, all sharing one entry with one set of aliases. Handing
 * every campus its family's aliases makes every one of them answer to "IIT",
 * which makes the key ambiguous, which deletes it below — the first cut of this
 * import lost every AIIMS and every IISER exactly that way.
 *
 * So a file gets the family's keys only if it *is* the family — `aiims.png`,
 * whose name is the entry's own short form. A campus file keeps its own name,
 * and gains one composite phrase: `iit-bombay` answers to "Indian Institute of
 * Technology Bombay", which is longer than the family phrase and therefore
 * beats it. That is how "Indian Institute of Science Education and Research
 * Kolkata" reaches IISER Kolkata rather than the Indian Institute of Science,
 * whose name is a prefix of it.
 */
function buildLogoProfiles(files, aliasEntries) {
  const byKey = new Map(); // normalised key → alias entry
  for (const entry of aliasEntries) {
    for (const key of [entry.name, ...entry.short_forms, ...entry.aliases].map(norm)) {
      if (key && !byKey.has(key)) byKey.set(key, entry);
    }
  }

  const profiles = [];

  for (const file of files) {
    const base = file.name.replace(/\.[a-z0-9]+$/i, "");
    const stripped = base.replace(FILE_SUFFIX_RE, "").trim();
    if (SKIP.has(stripped)) continue;

    const fileWords = content(stripped.replace(/-/g, " "));

    const entry =
      byKey.get(norm(stripped)) ??
      byKey.get(norm(base)) ??
      byKey.get(acronym(fileWords)) ??
      // Trailing acronym in the file name — `union-public-service-commission-upsc`.
      byKey.get(norm(fileWords.at(-1) ?? "")) ??
      null;

    // The names an entry answers to *as itself*, as opposed to its aliases —
    // which for a family entry include its individual campuses.
    const identity = entry ? [entry.name, ...entry.short_forms].map(norm) : [];
    const isFamilyMark =
      entry !== null && (identity.includes(norm(stripped)) || identity.includes(norm(base)));

    const keys = new Set([norm(base), norm(stripped)]);
    if (fileWords.length > 1) keys.add(acronym(fileWords));
    if (isFamilyMark) {
      for (const key of [entry.name, ...entry.short_forms, ...entry.aliases])
        keys.add(norm(key));
    }
    keys.delete("");

    const phrases = [fileWords];
    if (entry) {
      const entryPhrase = content(entry.name);
      phrases.push(entryPhrase);

      if (!isFamilyMark) {
        // `iit-bombay` → "Indian Institute of Technology Bombay". The leading
        // token is the family's own acronym and is dropped, not repeated.
        const lead = norm(fileWords[0] ?? "");
        const campus = identity.includes(lead) ? fileWords.slice(1) : fileWords;
        if (campus.length > 0) phrases.push([...entryPhrase, ...campus]);
      }
    }

    profiles.push({
      file: file.name,
      base,
      stripped,
      entry,
      keys,
      phrases,
      // Two files can be the same body under two names — `aiims.png` and
      // `all-india-institute-of-medical-sciences.png`. Ties between those are
      // not ambiguity, they are a duplicate.
      body: isFamilyMark ? `entry:${entry.name}` : `file:${base}`,
    });
  }

  // ── Ambiguity ───────────────────────────────────────────────────────────
  // "ECIL" is Electronics Corporation of India Limited and it is also
  // Educational Consultants India Limited, and both are in this bucket. A key
  // that two *bodies* answer to identifies neither, so it is removed from both
  // rather than awarded to whichever happened to be listed first — which is how
  // the old app put the EdCIL mark on ECIL's jobs.
  const owners = new Map();
  for (const p of profiles) {
    for (const key of p.keys) {
      owners.set(key, (owners.get(key) ?? new Set()).add(p.body));
    }
  }
  for (const p of profiles) {
    for (const key of p.keys) if (owners.get(key).size > 1) p.keys.delete(key);
  }

  return profiles;
}

/**
 * A name reduced to the words that carry identity, singularised.
 *
 * The plural matters: the alias table calls the family "Indian Institute**s** of
 * Technology" and a listing calls itself "Indian Institute of Technology
 * Bombay", and without this they are two unrelated phrases.
 */
const content = (value) =>
  words(value)
    .filter((w) => !STOPWORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));

/** "Airports Authority of India (AAI)" → "Airports Authority of India". */
const withoutTrailingAcronym = (name) => name.replace(/\s*\([A-Za-z0-9&.\- ]{2,12}\)\s*$/, "");

/**
 * How well an organisation name matches an image.
 *
 *   100  the name is the image's name, or one of its aliases, exactly
 *    95  its own bracket names it — "…Education and Research (IISER Pune)"
 *    92  it opens with, or first-brackets, the image's acronym — "(CSIR CFTRI)"
 *  90+n  the name *begins* with the image's n-word name — "AIIMS Bhopal"
 *
 * Every rung anchors on something the listing states about *itself*, and each
 * one is here because a looser version of it put a wrong emblem on a card:
 *
 * **Set membership** — every word of the image's name appearing anywhere in the
 * organisation's, which is what the old app scored on. It gave "Indian
 * Institute of Engineering Science and Technology, Shibpur" the Indian
 * Institute of Science emblem. Contiguity is what makes a phrase a name rather
 * than a bag of common words.
 *
 * **The phrase anywhere in the name** — still wrong.
 * `public-service-commission.jpg` is the *Union* PSC emblem and this handed it
 * to 47 state commissions; `staff-selection-commission.png` reached Haryana
 * SSC, a different body entirely. A qualifier in front of an institutional
 * phrase usually means a different institution, so only a match at the *start*
 * counts. The cost is accepted: the genuinely generic ITI mark no longer
 * reaches "Government Industrial Training Institute Anandapur".
 *
 * **An acronym token anywhere** — "Indian Navy SSC Officer" and "Goa PSC" both
 * collected commissions they have nothing to do with (in the Navy's case SSC is
 * Short Service Commission). An acronym is the body naming itself only when it
 * opens the string or sits in brackets; in the middle of a sentence it is
 * prose. That single restriction is what makes this rung safe enough to
 * outrank a phrase match — and it needs to outrank one, because
 * "…Science Education and Research (IISER Pune)" opens with the Indian
 * Institute of Science's name and is not that institute.
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

  // An acronym the listing states, rather than one this script invents — and
  // only where a body states its own: at the front, or in brackets.
  for (const token of selfNamingTokens(org.name)) {
    if (profile.keys.has(norm(token))) return 92;
  }

  const orgWords = content(org.name);
  let best = 0;
  for (const phrase of profile.phrases) {
    if (phrase.length > 0 && phrase.every((w, k) => orgWords[k] === w)) {
      // Longer phrase wins: "IIM Bodh Gaya" should not settle for an image
      // whose whole name is "IIM".
      best = Math.max(best, 90 + phrase.length);
    }
  }
  return best;
}

/**
 * The contents of the *first* bracketed group in a name, if there is one.
 *
 * Only the first, and that is the rule that keeps a joint venture from wearing
 * its parent's badge. "Hindustan Urvarak & Rasayan Limited (HURL) - a joint
 * venture of Indian Oil Corporation Limited (IOCL)…" brackets two bodies; the
 * first is what the listing calls itself and the second is who it mentions.
 * Reading every group gave HURL — and Mangalore Refinery, and a dozen other
 * subsidiaries — the parent company's emblem.
 */
function firstParenthetical(name) {
  const match = /\(([^)]{2,40})\)/.exec(name);
  return match ? [match[1]] : [];
}

/**
 * The tokens by which a listing names itself: the leading word, and anything
 * inside brackets. `ACRONYM_RE` keeps this to things shaped like an acronym —
 * a bare capitalised word ("Bhopal") is not one.
 */
function selfNamingTokens(name) {
  const ACRONYM_RE = /^[A-Z][A-Za-z0-9]{1,7}$/;
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

/* ── Supabase, over REST ────────────────────────────────────────────────── */

const authHeaders = { apikey: NEW_KEY, Authorization: `Bearer ${NEW_KEY}` };

async function fetchOrganizations() {
  const out = [];
  const step = 1000;
  for (let from = 0; ; from += step) {
    const res = await fetch(
      `${NEW_URL}/rest/v1/organizations?select=id,slug,name,logo_path&order=slug&offset=${from}&limit=${step}`,
      { headers: authHeaders },
    );
    if (!res.ok) throw new Error(`organizations: ${res.status} ${await res.text()}`);
    const page = await res.json();
    out.push(...page);
    if (page.length < step) return out;
  }
}

async function upload(path, body) {
  const res = await fetch(`${NEW_URL}/storage/v1/object/logos/${path}`, {
    method: "POST",
    headers: {
      ...authHeaders,
      "Content-Type": "image/webp",
      // A logo changes when a body redesigns it, which is a once-a-decade
      // event, so a long immutable cache is free. `upsert` is what makes a
      // re-run of this script idempotent rather than a 409.
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
 * ago. Grouping by path turns ~500 row updates into ~100 requests.
 */
async function writeLogoPaths(updates) {
  const byPath = new Map();
  for (const u of updates) byPath.set(u.logo_path, [...(byPath.get(u.logo_path) ?? []), u.id]);

  let done = 0;
  for (const [path, ids] of byPath) {
    // URLs have a length limit and these are uuids; 200 ids is ~7.5 kB.
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);
      const res = await fetch(`${NEW_URL}/rest/v1/organizations?id=in.(${batch.join(",")})`, {
        method: "PATCH",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({ logo_path: path }),
      });
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

  const aliasEntries = JSON.parse(
    readFileSync(resolve(import.meta.dirname, "data/organization-logo-aliases.json"), "utf8"),
  ).organizations;

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — logo import\n`);

  const files = await listLegacyLogos();
  console.log(`1. Old bucket: ${files.length} images`);

  const profiles = buildLogoProfiles(files, aliasEntries);
  const named = profiles.filter((p) => p.entry).length;
  console.log(
    `   ${named} matched to a curated alias entry, ${files.length - named} by name only`,
  );

  // ── Normalise and upload ────────────────────────────────────────────────
  let bytesIn = 0;
  let bytesOut = 0;
  const uploaded = new Map(); // profile.base → storage path

  console.log(`\n2. Normalising to ${RENDER_PX}px WebP${APPLY ? " and uploading" : ""}`);
  for (const profile of profiles) {
    const original = await downloadLegacyLogo(profile.file);
    const webp = await toWebp(sharp, original, profile.file);
    if (!webp) continue;

    bytesIn += original.length;
    bytesOut += webp.length;

    const path = `${PREFIX}/${profile.base}.webp`;
    // Two source files can normalise to one path — the old bucket holds both
    // `iit-bhu.png` and `iit-bhu.svg`. Same image, so last write wins and the
    // count below stays honest by keying on the path.
    if (APPLY) await upload(path, webp);
    uploaded.set(profile.base, path);
  }
  console.log(
    `   ${uploaded.size} objects · ${kb(bytesIn)} → ${kb(bytesOut)} ` +
      `(${Math.round((1 - bytesOut / bytesIn) * 100)}% smaller)`,
  );

  // ── Resolve ─────────────────────────────────────────────────────────────
  const organizations = await fetchOrganizations();
  console.log(`\n3. Resolving against ${organizations.length} organisations`);

  const updates = [];
  const cleared = [];
  const assignments = [];
  const unmatched = [];
  const byLogo = new Map(); // storage path → organisation names

  let ambiguous = 0;

  // A row that matched under an older version of the rules and no longer does
  // has its logo cleared rather than left standing, so re-running converges on
  // what the rules say today instead of accumulating the union of every version
  // of them.
  //
  // "Its logo", though, and no longer any logo. This script was written as the
  // column's only writer — the note in 0033 says so — and
  // `import-curated-logos.mjs` is now a second one, covering ~300 organisations
  // this bucket has no image for. Clearing unconditionally would delete every
  // one of those on the next run here, silently, because a row wearing a
  // curated emblem is exactly a row this script does not match.
  //
  // So the clear is scoped to paths this script itself uploaded a moment ago.
  // Convergence still holds for everything it owns; what it does not own it
  // leaves alone, which is the correct behaviour for one of two writers.
  const ownPaths = new Set(uploaded.values());

  for (const org of organizations) {
    // A tie is an answer too, and the answer is "no". Six IISER campuses score
    // identically on "Indian Institute of Science Education and Research" —
    // picking whichever was listed first would put Pune's crest on Kolkata's
    // jobs, which is a wrong logo wearing the confidence of a right one.
    let bestScore = 0;
    let contenders = new Map(); // storage path → body

    for (const profile of profiles) {
      const path = uploaded.get(profile.base);
      if (!path) continue;
      const score = scoreLogo(profile, org);
      if (score === 0 || score < bestScore) continue;
      if (score > bestScore) {
        bestScore = score;
        contenders = new Map();
      }
      contenders.set(path, profile.body);
    }

    if (bestScore < MIN_SCORE || contenders.size === 0) {
      unmatched.push(org.name);
      if (org.logo_path !== null && ownPaths.has(org.logo_path)) {
        cleared.push({ id: org.id, logo_path: null });
      }
      continue;
    }

    // Two files of the same body is a duplicate, and either will do — sorted so
    // that "which one" is at least stable between runs. Two files of different
    // bodies is a genuine tie and gets no logo.
    const bodies = new Set(contenders.values());
    if (bodies.size > 1) {
      ambiguous++;
      unmatched.push(org.name);
      if (org.logo_path !== null && ownPaths.has(org.logo_path)) {
        cleared.push({ id: org.id, logo_path: null });
      }
      continue;
    }

    const best = [...contenders.keys()].sort()[0];

    byLogo.set(best, [...(byLogo.get(best) ?? []), org.name]);
    assignments.push({ name: org.name, logo_path: best, score: bestScore });
    if (org.logo_path !== best) {
      updates.push({ id: org.id, slug: org.slug, name: org.name, logo_path: best });
    }
  }

  const matched = organizations.length - unmatched.length;
  console.log(
    `   ${matched} organisations matched (${pct(matched, organizations.length)}), ` +
      `${byLogo.size} of ${uploaded.size} images used, ${updates.length} rows to write`,
  );
  console.log(`   ${ambiguous} left unmatched because two images tied`);
  if (cleared.length > 0) {
    console.log(`   ${cleared.length} rows to clear — matched once, no longer do`);
  }

  console.log("\n   Images by reach:");
  for (const [path, names] of [...byLogo]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 20)) {
    console.log(
      `     ${String(names.length).padStart(4)}  ${path.replace(`${PREFIX}/`, "")}` +
        `  ·  ${names.slice(0, 2).join(" | ").slice(0, 90)}`,
    );
  }

  if (REPORT_MATCHED) {
    // Every assignment, one per line, for reading with `less` or `grep`. This
    // is the review surface: a rule that has gone wrong is visible here as a
    // run of organisations that plainly are not the body on the badge.
    console.log(`\n   Matched (${matched}):`);
    for (const { name, logo_path, score } of assignments) {
      console.log(`     ${score}  ${logo_path.replace(`${PREFIX}/`, "").padEnd(48)}  ${name}`);
    }
  }

  if (REPORT_UNMATCHED) {
    console.log(`\n   Unmatched (${unmatched.length}):`);
    for (const name of unmatched) console.log(`     ${name}`);
  }

  if (!APPLY) {
    console.log("\nDry run — nothing uploaded, nothing written. Re-run with --apply.");
    return;
  }

  console.log("\n4. Writing logo_path");
  await writeLogoPaths([...updates, ...cleared]);
  console.log("   done");
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} kB`;
const pct = (part, total) => `${((part / total) * 100).toFixed(1)}%`;

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

await main();
