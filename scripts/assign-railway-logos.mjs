#!/usr/bin/env node
/**
 * Gives the Indian Railways bodies that have no emblem the one they all share.
 *
 * ── The bug this fixes ─────────────────────────────────────────────────────
 * `RRB ALP (CEN 01/2026)` — the largest railway listing on the site — drew a
 * grey tile reading `MRGI`. Not because the emblem is missing from the bucket:
 * `organizations/indian-railways.webp` has been there since the curated import.
 * The listing simply is not filed under a Railway Recruitment Board row. The
 * feed named its employer `Ministry of Railways, Government of India (Various
 * Zonal Railways)`, `resolveOrganizations` had nothing to match that against,
 * and so it created a body of its own — one nobody has ever uploaded a logo
 * for, and nobody ever will, because the name will not recur.
 *
 * The same shape covers the rest of Indian Railways: every zonal railway, every
 * Railway Recruitment Cell, every production unit arrives under whatever name
 * the notice used, gets its own row, and shows initials. Thirty rows, one
 * employer, one emblem — and the emblem is already uploaded.
 *
 * So this is not a logo import. It is a column write: point the rows that are
 * Indian Railways at the file that is Indian Railways.
 *
 * ── Why an explicit list and not a name match ───────────────────────────────
 * `name ilike '%rail%'` would sweep in Delhi Metro Rail Corporation, Konkan
 * Railway, RITES and NHSRCL — separate undertakings with their own marks, and
 * putting the Indian Railways seal on DMRC is a worse failure than the initials
 * it replaced, because it looks deliberate. Every slug below was read off the
 * table and classified by hand. Adding to it is meant to be a deliberate act.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *
 *   node scripts/assign-railway-logos.mjs            # dry run — prints the plan
 *   node scripts/assign-railway-logos.mjs --apply    # write + revalidate
 *
 * Re-running is safe: a row that already holds a logo is never touched, so this
 * only ever fills blanks. Run it again after a month of ingestion has invented
 * three more spellings of "East Coast Railway" — but add their slugs first.
 *
 * Environment (.env.local, or exported):
 *
 *   NEXT_PUBLIC_SUPABASE_URL   project URL
 *   SUPABASE_SECRET_KEY        service key — `organizations` is closed to the
 *                              publishable one
 *   REVALIDATE_SECRET          bearer token for /api/revalidate
 *   REVALIDATE_URL             optional; defaults to production. Not read from
 *                              NEXT_PUBLIC_SITE_URL, which is localhost in both
 *                              local env files — the purge would land on a dev
 *                              server and production would keep the initials.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const APPLY = process.argv.slice(2).includes("--apply");

/** The emblem every body below flies. Already in the bucket at 128 px. */
const LOGO_PATH = "organizations/indian-railways.webp";

/**
 * Indian Railways, under every name the feed has filed it as.
 *
 * Grouped by what the body actually is, because that is the question being
 * answered for each line — "is this Indian Railways itself, or an undertaking
 * with its own identity" — and the grouping is what makes a wrong entry visible
 * when someone adds one.
 */
const SLUGS = [
  // The ministry, and the catch-all name RRB notices are sometimes filed under.
  "ministry-of-railways-government-of-india-various-zonal-railways",

  // Zonal railways.
  "central-railway",
  "east-coast-railway",
  "south-eastern-railway",
  "southern-railway-act-apprentice",
  "northeast-frontier-railway-nf-railway-maligaon-guwahati11-assam",
  "northeast-frontier-railway-nfr-personnel-department",
  "northeast-frontier-railway-scouts-and-guides-quota",
  "northeast-frontier-railway-sports-quota",
  "tiruppur-railway-station",

  // Railway Recruitment Cells — the zonal counterpart to the RRBs.
  "railway-recruitment-cell-nr",
  "railway-recruitment-cell-ser",
  "railway-recruitment-cell-rrc-north-central-railway",
  "railway-recruitment-cell-central-railway-rrccr",
  "railway-recruitment-cell-western-railway-rrcwr-ministry-of-railway-government-of",
  "rrc-central-railway",
  "rrc-eastern-railway",
  "rrc-ncr-cultural-quota",

  // Production units and workshops — departmental, not separate companies.
  "integral-coach-factory-icf-chennai",
  "rail-coach-factory-kapurthala-rcf",
  "rail-wheel-factory-rwf-yelahanka-bangalore-ministry-of-railways",
  "rail-wheel-factory-sports-association",
  "chittaranjan-locomotive-works-clw",
  "staff-benefit-fund-management-committee-clwchittaranjan-ministry-of-railways",
];

/*
 * Deliberately absent, and each for the same reason — a mark of its own that
 * this seal would displace:
 *
 *   Konkan Railway (KRCL), Mumbai Railway Vikas Corporation (MRVC),
 *   NHSRCL, IPRCL, RITES, IRCTC, IRFC, and every metro corporation
 *   (DMRC, BMRCL, CMRL, KMRL, NMRC, GMRC, MPMRCL, Maha Metro).
 *
 * They are missing logos too. That is an upload, not a column write.
 */

/* ── Environment ───────────────────────────────────────────────────────── */

for (const file of [".env.local", ".env.development.local"]) {
  try {
    for (const line of readFileSync(resolve(ROOT, file), "utf8").split("\n")) {
      const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // Absent is fine — the values may be exported instead.
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SECRET_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(1);
}

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

/* ── The emblem must exist before anything points at it ────────────────── */

const probe = await fetch(`${SUPABASE_URL}/storage/v1/object/public/logos/${LOGO_PATH}`, {
  method: "HEAD",
});

if (!probe.ok) {
  // Writing a path to an object that is not there is the one outcome worse than
  // the initials: `OrganizationLogo` unmounts on a 404, so the tile goes blank
  // rather than falling back, and the admin coverage page counts the row as
  // done. Fail here instead.
  console.error(
    `${LOGO_PATH} is not in the bucket (HTTP ${String(probe.status)}). Nothing written.`,
  );
  process.exit(1);
}

/* ── Read ──────────────────────────────────────────────────────────────── */

const query = new URLSearchParams({
  select: "id,slug,name,logo_path",
  slug: `in.(${SLUGS.join(",")})`,
});

const read = await fetch(`${SUPABASE_URL}/rest/v1/organizations?${query.toString()}`, {
  headers,
});

if (!read.ok) {
  console.error(`read failed: ${String(read.status)} ${await read.text()}`);
  process.exit(1);
}

const rows = await read.json();
const found = new Set(rows.map((row) => row.slug));

// A slug in the list that is not in the table is worth saying out loud: it is
// either a typo here or a row a merge has since folded away.
for (const slug of SLUGS) {
  if (!found.has(slug)) console.warn(`  ? no such organisation: ${slug}`);
}

const blank = rows.filter((row) => !row.logo_path);
const held = rows.filter((row) => row.logo_path && row.logo_path !== LOGO_PATH);

for (const row of held) {
  // Never displaced. A row that already carries a mark carries a better one
  // than the parent seal — that is the rule `import-curated-logos.mjs` arrived
  // at by watching IIT BHU lose its emblem to the parent university's.
  console.log(`  = keeping ${row.logo_path} on ${row.slug}`);
}

for (const row of blank) console.log(`  + ${row.slug}  (${row.name})`);

console.log(
  `\n${String(blank.length)} to fill, ${String(rows.length - blank.length)} already set, ` +
    `${String(SLUGS.length - rows.length)} not on file.`,
);

if (blank.length === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}

if (!APPLY) {
  console.log("\nDry run. Re-run with --apply to write.");
  process.exit(0);
}

/* ── Write ─────────────────────────────────────────────────────────────── */

const write = await fetch(
  `${SUPABASE_URL}/rest/v1/organizations?id=in.(${blank.map((row) => row.id).join(",")})`,
  {
    method: "PATCH",
    headers: { ...headers, Prefer: "return=minimal" },
    body: JSON.stringify({ logo_path: LOGO_PATH }),
  },
);

if (!write.ok) {
  console.error(`write failed: ${String(write.status)} ${await write.text()}`);
  process.exit(1);
}

console.log(`\nWrote logo_path on ${String(blank.length)} rows.`);

/* ── Purge ─────────────────────────────────────────────────────────────── */

// The www host, not the apex: the apex redirects, and `fetch` drops the
// Authorization header across the redirect, so the route answers 401 to a
// correct secret.
const siteUrl = process.env.REVALIDATE_URL ?? "https://www.jobstrackr.in";
const secret = process.env.REVALIDATE_SECRET;

if (!secret) {
  console.warn("REVALIDATE_SECRET not set — cache not purged.");
  console.warn("Pages will keep showing initials until they next revalidate.");
  process.exit(0);
}

// A job's detail page is tagged `job:<slug>` and nothing else — not with its
// organisation — so purging `org:*` alone would refresh the lists and leave
// the RRB ALP page, the one that started this, drawing MRGI. Every job under a
// filled row is purged, whatever its status — a tag with no cached page behind
// it costs nothing.
const jobs = await fetch(
  `${SUPABASE_URL}/rest/v1/jobs?select=slug&organization_id=in.(${blank.map((row) => row.id).join(",")})`,
  { headers },
);

if (!jobs.ok) {
  console.error(`job read failed: ${String(jobs.status)} ${await jobs.text()}`);
  console.error("logo_path is written; re-run to purge.");
  process.exit(1);
}

const tags = [
  ...blank.map((row) => `org:${row.slug}`),
  ...(await jobs.json()).map((job) => `job:${job.slug}`),
  "jobs:list",
  "orgs:list",
];

// The route takes at most 200 tags a request.
if (tags.length > 200) {
  console.error(`${String(tags.length)} tags is over the route's 200 cap; split the purge.`);
  process.exit(1);
}

const purge = await fetch(`${siteUrl.replace(/\/$/, "")}/api/revalidate`, {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
  body: JSON.stringify({ tags }),
});

if (!purge.ok) {
  console.error(`revalidate failed: ${String(purge.status)} ${await purge.text()}`);
  process.exit(1);
}

console.log(`Purged ${String(tags.length)} cache tags.`);
