#!/usr/bin/env node
/**
 * Gives an update the organisation it is about, by reading its title.
 *
 * ── Why every update card drew the same grey tile ──────────────────────────
 * `exam_updates.organization_id` was NULL on all 6,285 rows before this ran.
 * `UpdateCard` reads the logo, the subtitle and the monogram from that one
 * join, so with it empty every card in `/updates` rendered the same initials —
 * `toInitials` falls through the organisation, then the exam, and lands on the
 * literal "GOVT".
 *
 * It is empty because nothing ever filled it. The sync path does set it
 * (`updates.ts` resolves `row.organization ?? row.conducting_body`), but the
 * 6,285 rows here came from the migration, and the old project's `exam_updates`
 * has no such column — `backfill-from-old-project.mjs` says so in the comment
 * on `UPDATE_COLUMNS`. There was never a body name to carry across.
 *
 * So the title is the only evidence there is, and these titles are written to a
 * house style that puts the body first: "UPPSC RO ARO Assessment pattern 2025",
 * "IBPS RRB Clerk Mains Hall ticket 2025". That is the signal this reads.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *
 *   node scripts/link-updates-to-organizations.mjs              # dry run
 *   node scripts/link-updates-to-organizations.mjs --apply
 *   node scripts/link-updates-to-organizations.mjs --report | less
 *   node scripts/link-updates-to-organizations.mjs --report-unmatched
 *
 * Re-running is safe and is the intended maintenance path: a row that already
 * has an organisation is never touched, so this only ever fills holes. To undo
 * a run, null the column back out for the rows it set — nothing else writes it
 * for migrated rows.
 *
 * Environment (in .env.local, or exported):
 *
 *   NEXT_PUBLIC_SUPABASE_URL     project URL
 *   SUPABASE_SECRET_KEY          service key
 *
 * ## Why it links to so few, on purpose
 *
 * Just under a third of the table gets an organisation. The rest name a body
 * that is not in `logos_audit_report.csv` — state boards, high courts,
 * universities, district offices — and most of those have no logo to show
 * either, so linking them would buy a subtitle and nothing else. Reaching them
 * would mean matching a
 * title against the 3,794-row `organizations` table, which is not a table of
 * institutions: ingestion creates a row from whatever string a feed carried, so
 * it holds "SSC CGL 2026" and "Indian Army TES 56" beside "Staff Selection
 * Commission". An earlier cut of this script did match against it and reached a
 * third of the table, and the cost showed up immediately in the dry run: the
 * body it picked for an SSC GD update was the row named "SSC CGL", so the card
 * would have said so underneath the title.
 *
 * Writing this column is not only a logo. It is the card's subtitle and its
 * monogram, and on `/updates/[slug]` it is a named link to the body's page. A
 * wrong one is a factual claim about who is recruiting; a missing one is the
 * grey tile that is already there. So the bar is the audited set, where the
 * body's real name is known, and the rest keep the tile.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ── Configuration ─────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const REPORT = args.includes("--report");
const REPORT_UNMATCHED = args.includes("--report-unmatched");

const ROOT = resolve(import.meta.dirname, "..");
const AUDIT_CSV = resolve(ROOT, "logos_audit_report.csv");

/**
 * Acronyms the audit's own column gets wrong, and what they should be.
 *
 * `Acronym` is a short label someone typed, not an identifier, and two of them
 * cost more than the rest of the file put together:
 *
 * **Uttarakhand's commission is UKPSC**, not UPSC. Filed under "UPSC" it
 * collides with the Union Public Service Commission, the ambiguity rule quite
 * correctly drops the key from both, and the single most recognisable body on
 * the site loses all 77 of its updates to protect a state commission from a
 * name it does not use.
 *
 * The railway boards look like a second case and are not. Their audit row's
 * acronym is the caption "RRB / RRC Centralized Logo", but correcting it to
 * ["RRB", "RRC"] fixes nothing: no organisation is named "Indian Railways", so
 * that body has no row to link to either way, and the corrected acronyms only
 * collide with the `EXTRA_BODIES` entry that does have one — leaving both
 * ambiguous and the boards unmatched. They are handled there instead.
 *
 * Corrections rather than an edit to the CSV: that file is the audit's output
 * and re-running the audit would overwrite it, taking the fixes with it. Keyed
 * by name, so a correction whose row is renamed stops applying instead of
 * silently attaching to the wrong body.
 */
const ACRONYM_CORRECTIONS = new Map([
  ["Uttarakhand Public Service Commission (UPSC)", ["UKPSC"]],
]);

/**
 * Bodies with a logo and an organisation row, but no row in the audit.
 *
 * The audit is the source of a body's *name*, which is what makes the rest of
 * this script safe, so a body missing from it is normally left alone. This list
 * is for the case where that costs too much: the railway recruitment boards
 * publish 136 of the updates in this table — the largest single block — and
 * their logo has been on their organisation rows since the legacy import, under
 * a path the audit never names.
 *
 * Kept deliberately short and pinned to a slug rather than a name, so an entry
 * either resolves to exactly the row it was written for or does nothing. Adding
 * to it means opening the organisation, checking the logo is that body's, and
 * checking the acronym is not one another body in the audit also uses — the
 * ambiguity pass covers the audit, not this.
 */
const EXTRA_BODIES = [
  {
    // "Indian Railways (RRB / RRC Centralized Logo)" is in the audit but no
    // organisation is named "Indian Railways", so it has no row to link to.
    // This one is named for the boards themselves, which is also the better
    // subtitle for an "RRB NTPC Hall ticket" card.
    slug: "railway-recruitment-board-rrb",
    name: "Railway Recruitment Board (RRB)",
    acronyms: ["RRB", "RRC"],
  },
];

/**
 * Institutional phrases with a spoken short form the audit does not carry.
 *
 * A commission's full name is "Mizoram Public Service Commission" and its
 * acronym is "MPSC", and the titles use neither — they say "Mizoram PSC", which
 * is a third form matching no key. It is also the *unambiguous* form: "MPSC" is
 * claimed by four states and correctly dropped, whereas "Mizoram PSC" names one
 * commission and nothing else. Keying it recovers 71 updates that the acronym
 * collision had made unreachable.
 */
const SPOKEN_FORMS = [{ phrase: "public service commission", short: "psc" }];

/** How far into a title to look for the body's name. Everything past this is
 *  the post and the year — "Assistant Section Officer ASO Test structure 2025"
 *  — and a body named that deep in the string is being mentioned, not naming
 *  itself. Eight covers the longest institution in the set. */
const MAX_LEAD_WORDS = 8;

loadEnvLocal();

const SUPABASE_URL = required("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_KEY = required("SUPABASE_SECRET_KEY");

/* ── Normalisation ─────────────────────────────────────────────────────── */

const norm = (value) => value.toLowerCase().replace(/[^a-z0-9]/g, "");

const wordsOf = (value) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** "Airports Authority of India (AAI)" → "Airports Authority of India". */
const withoutTrailingAcronym = (name) =>
  name.replace(/\s*\([A-Za-z0-9&.\-/ ]{2,40}\)\s*$/, "").trim();

/** A body's name → the object its logo is stored under, matching the slug
 *  `import-curated-logos.mjs` uploads to. The two must agree: this script finds
 *  a body's organisation rows by looking up that path. */
const slugify = (name) =>
  withoutTrailingAcronym(name)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** See the note on the identical reader in `import-curated-logos.mjs`. */
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
 * "IIT" + "Indian Institute of Technology Delhi" → `iitdelhi`.
 *
 * A third of the audited set is campuses — 8 IITs, 7 AIIMS, 7 NITs, 6 IIMs —
 * and every one of them is filed under its family's acronym, so "IIT" names
 * eight bodies and the ambiguity rule drops it from all of them. Correctly: an
 * update titled "IIT Recruitment" names no campus in particular. But 294 titles
 * open "IIT Delhi", "IIT Madras", "IIT Kharagpur", and those name exactly one
 * body each — they simply say it in the short form the audit does not carry.
 *
 * The acronym's own length is what splits the name: "IIT" is three letters, so
 * the family is the first three content words and whatever follows is the
 * campus. The split is only taken when those words' initials actually spell the
 * acronym, which is what stops it firing on a body whose acronym is unrelated
 * to its name.
 *
 * Every trailing run of the campus is keyed, not just the whole of it, because
 * a campus's formal name is longer than its spoken one: the institute is "All
 * India Institute of Medical Sciences New Delhi" and the title says "AIIMS
 * Delhi". Producing both `aiimsnewdelhi` and `aiimsdelhi` covers that, and a
 * suffix that turns out to name two campuses is dropped by the ambiguity pass
 * like any other key.
 */
/**
 * "Mizoram Public Service Commission" → `mizorampsc`.
 *
 * Only when the phrase *ends* the name, so the qualifier in front is what the
 * short form keeps — which is the half that identifies the body. A name that is
 * the bare phrase itself yields nothing: "psc" alone names every commission in
 * the country.
 */
function spokenKeys(bare) {
  const parts = wordsOf(bare);
  const out = [];

  for (const { phrase, short } of SPOKEN_FORMS) {
    const tail = wordsOf(phrase);
    if (parts.length <= tail.length) continue;
    const head = parts.slice(0, parts.length - tail.length);
    const isSuffix = parts.slice(-tail.length).every((w, i) => tail[i] === w);
    if (isSuffix) out.push(norm(head.join("") + short));
  }
  return out;
}

function campusKeys(acronym, bare) {
  const letters = acronym.replace(/[^A-Za-z]/g, "");
  const parts = wordsOf(bare).filter((w) => !NAME_STOPWORDS.has(w));
  if (letters.length < 2 || parts.length <= letters.length) return [];

  const family = parts.slice(0, letters.length);
  if (
    family
      .map((w) => w[0])
      .join("")
      .toUpperCase() !== letters.toUpperCase()
  )
    return [];

  const campus = parts.slice(letters.length);
  return campus.map((_, i) => norm(letters + campus.slice(i).join("")));
}

/** Words that carry no identity, so "Board of Secondary Education" reads BSE
 *  rather than BOSE — the same list the logo import uses. */
const NAME_STOPWORDS = new Set([
  "and",
  "of",
  "the",
  "for",
  "in",
  "to",
  "on",
  "with",
  "by",
  "a",
]);

/* ── Supabase, over REST ────────────────────────────────────────────────── */

const authHeaders = { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` };

async function fetchAll(path) {
  const out = [];
  const step = 1000;
  for (let from = 0; ; from += step) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}&offset=${from}&limit=${step}`, {
      headers: authHeaders,
    });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    const page = await res.json();
    out.push(...page);
    if (page.length < step) return out;
  }
}

/**
 * Writes `organization_id`, one request per organisation.
 *
 * PATCH rather than upsert, for the reason the logo import gives: an upsert has
 * to send every not-null column, and a typo in that list would rewrite `title`
 * on thousands of rows. This can only touch the column it names.
 */
async function writeOrganizationIds(updates) {
  const byOrg = new Map();
  for (const u of updates) byOrg.set(u.orgId, [...(byOrg.get(u.orgId) ?? []), u.id]);

  let done = 0;
  for (const [orgId, ids] of byOrg) {
    for (let i = 0; i < ids.length; i += 200) {
      const batch = ids.slice(i, i + 200);
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/exam_updates?id=in.(${batch.join(",")})`,
        {
          method: "PATCH",
          headers: {
            ...authHeaders,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ organization_id: orgId }),
        },
      );
      if (!res.ok) throw new Error(`update: ${res.status} ${await res.text()}`);
      done += batch.length;
      process.stdout.write(`\r   wrote ${done}/${updates.length}`);
    }
  }
  process.stdout.write("\n");
}

/* ── Bodies ─────────────────────────────────────────────────────────────── */

/**
 * One profile per audited body: the names it answers to, and the organisation
 * row an update should point at.
 *
 * The rows for a body are the ones carrying its logo — `logo_path` is already
 * the answer to "which of these 3,794 rows are the same institution", computed
 * once by the logo import and worth reusing rather than recomputing from names.
 *
 * The row picked out of that group is the one whose name *is* the institution,
 * ignoring a trailing bracket: "Bank of Baroda" and "Bank of Baroda (BoB)"
 * qualify, "BOB Apprentice 2026" does not. A body with no such row is dropped
 * rather than given its least-bad row, because this column is read as the
 * card's subtitle — see the header. That is what most of the 128 dropped bodies
 * are: real institutions whose only rows here are vacancy titles.
 */
function buildBodies(auditRows, organizations) {
  const byLogo = new Map();
  for (const org of organizations) {
    if (org.logo_path) byLogo.set(org.logo_path, [...(byLogo.get(org.logo_path) ?? []), org]);
  }

  const bodies = auditRows.map((row) => {
    const rows = byLogo.get(`organizations/${slugify(row.Name)}.webp`) ?? [];
    const bare = withoutTrailingAcronym(row.Name);

    const named = rows
      .filter((o) => norm(withoutTrailingAcronym(o.name)) === norm(bare))
      .sort((a, b) => a.name.length - b.name.length);

    const acronyms = ACRONYM_CORRECTIONS.get(row.Name) ?? [row.Acronym];
    const keys = new Set([norm(row.Name), norm(bare), ...acronyms.map(norm)]);
    for (const acronym of acronyms) for (const key of campusKeys(acronym, bare)) keys.add(key);
    for (const key of spokenKeys(bare)) keys.add(key);
    keys.delete("");
    // Two characters name nothing — see the same rule, and the same reason, in
    // `import-curated-logos.mjs`.
    for (const key of [...keys]) if (key.length < 3) keys.delete(key);

    return {
      name: row.Name,
      keys,
      phrase: wordsOf(bare),
      organization: named[0] ?? null,
      hasRows: rows.length > 0,
    };
  });

  // Appended before the ambiguity pass, not after, so an extra body's acronym
  // is held to the same rule as an audited one — an entry that collides with a
  // body in the audit disables both, rather than quietly winning.
  const bySlug = new Map(organizations.map((o) => [o.slug, o]));
  for (const extra of EXTRA_BODIES) {
    const organization = bySlug.get(extra.slug) ?? null;
    if (!organization) {
      console.warn(`  ! EXTRA_BODIES: no organisation with slug "${extra.slug}" — skipped`);
      continue;
    }
    const bare = withoutTrailingAcronym(extra.name);
    const keys = new Set([norm(extra.name), norm(bare), ...extra.acronyms.map(norm)]);
    for (const key of spokenKeys(bare)) keys.add(key);
    keys.delete("");
    for (const key of [...keys]) if (key.length < 3) keys.delete(key);

    bodies.push({ name: extra.name, keys, phrase: wordsOf(bare), organization, hasRows: true });
  }

  // ── Ambiguity ───────────────────────────────────────────────────────────
  // Over every audited body, including the ones no organisation row carries.
  // Scoping this to linkable bodies only — which an earlier cut did — leaves a
  // shared acronym owned by whichever body happens to have a row, and the two
  // that shared one here were neighbouring states. "GPSC" belongs to Goa and to
  // Gujarat; Goa had a row and Gujarat did not, so 42 updates whose own titles
  // end in "@gpsc.gujarat.gov.in" were about to be filed under Goa. "APPSC" put
  // 54 of Andhra Pradesh's under Arunachal the same way.
  const owners = new Map();
  for (const b of bodies) {
    for (const key of b.keys) owners.set(key, (owners.get(key) ?? new Set()).add(b.name));
  }
  let dropped = 0;
  for (const b of bodies) {
    for (const key of b.keys) {
      if (owners.get(key).size > 1) {
        b.keys.delete(key);
        dropped++;
      }
    }
  }

  return { bodies, dropped };
}

/**
 * The body a title names, or null.
 *
 * Anchored at the start and nowhere else. The body that publishes a
 * notification writes its own name first; one that turns up later in the
 * sentence is being referred to — "…Result at ibpsreg.ibps.in" on a Punjab
 * National Bank card names IBPS because IBPS ran the exam, and filing it under
 * IBPS would be wrong. Longest lead wins, so "Central Bank of India" is not
 * settled by a shorter key that also matches its opening word.
 */
function matchTitle(title, bodies) {
  const lead = wordsOf(title);

  let best = 0;
  let contenders = new Map();

  for (const body of bodies) {
    let score = 0;
    for (let n = Math.min(MAX_LEAD_WORDS, lead.length); n >= 1; n--) {
      const prefix = lead.slice(0, n);
      const isKey = body.keys.has(norm(prefix.join("")));
      const isPhrase = body.phrase.length === n && body.phrase.every((w, i) => prefix[i] === w);
      if (isKey || isPhrase) {
        score = n;
        break;
      }
    }
    if (score === 0 || score < best) continue;
    if (score > best) {
      best = score;
      contenders = new Map();
    }
    contenders.set(body.name, body);
  }

  // A tie is an answer, and the answer is "no".
  if (best === 0 || contenders.size !== 1) return null;
  return { body: [...contenders.values()][0], words: best };
}

/* ── Main ───────────────────────────────────────────────────────────────── */

async function main() {
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — link updates to organisations\n`);

  const auditRows = parseCsv(readFileSync(AUDIT_CSV, "utf8"));
  const organizations = await fetchAll(
    "organizations?select=id,slug,name,logo_path&order=slug",
  );
  const { bodies, dropped } = buildBodies(auditRows, organizations);

  const linkable = bodies.filter((b) => b.organization && b.keys.size > 0);

  console.log(`1. Bodies: ${bodies.length} audited`);
  console.log(`   ${bodies.filter((b) => !b.hasRows).length} that no organisation row carries`);
  console.log(
    `   ${bodies.filter((b) => b.hasRows && !b.organization).length} whose only rows are vacancy titles`,
  );
  console.log(`   ${linkable.length} linkable · ${dropped} keys dropped as ambiguous`);

  const updates = await fetchAll("exam_updates?select=id,slug,title,organization_id&order=id");
  const open = updates.filter((u) => !u.organization_id);
  console.log(`\n2. Updates: ${updates.length} rows, ${open.length} without an organisation`);

  const writes = [];
  const matched = [];
  const unmatched = [];
  const reach = new Map();

  for (const update of open) {
    const hit = matchTitle(update.title, linkable);
    if (!hit) {
      unmatched.push(update);
      continue;
    }
    const org = hit.body.organization;
    writes.push({ id: update.id, orgId: org.id });
    matched.push({ title: update.title, org: org.name, words: hit.words });
    reach.set(org.name, (reach.get(org.name) ?? 0) + 1);
  }

  console.log(
    `\n3. Matched ${matched.length} of ${open.length} (${pct(matched.length, open.length)}) ` +
      `across ${reach.size} bodies`,
  );

  console.log("\n   Bodies by reach:");
  for (const [name, count] of [...reach].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log(`     ${String(count).padStart(4)}  ${name.slice(0, 68)}`);
  }

  if (REPORT) {
    // The review surface. Each line is a claim the card will make about who is
    // recruiting, so a bad key shows up here as a run of titles that plainly
    // are not the body beside them.
    console.log(`\n   Matched (${matched.length}):`);
    for (const m of matched) {
      console.log(
        `     ${m.words}w  ${m.org.slice(0, 44).padEnd(46)}  ${m.title.slice(0, 78)}`,
      );
    }
  }

  if (REPORT_UNMATCHED) {
    // Grouped by opening words, because that is the shape of a missing body: a
    // hundred titles all starting "Patna High Court" means one image away.
    const leads = new Map();
    for (const u of unmatched) {
      const key = wordsOf(u.title).slice(0, 2).join(" ");
      leads.set(key, (leads.get(key) ?? 0) + 1);
    }
    console.log(`\n   Unmatched (${unmatched.length}) — most common openings:`);
    for (const [lead, count] of [...leads].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
      console.log(`     ${String(count).padStart(4)}  ${lead}`);
    }
  }

  if (!APPLY) {
    console.log("\nDry run — nothing written. Re-run with --apply.");
    return;
  }

  console.log(`\n4. Writing organization_id on ${writes.length} rows`);
  await writeOrganizationIds(writes);
  console.log("   done");
}

/* ── Helpers ────────────────────────────────────────────────────────────── */

const pct = (part, total) => (total === 0 ? "—" : `${((part / total) * 100).toFixed(1)}%`);

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
