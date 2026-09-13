#!/usr/bin/env node
/**
 * Reconciles a Search Console export against what the site actually serves.
 *
 * Search Console tells you a URL is not indexed. It does not tell you whether
 * that is still true, whether it was ever meant to be a URL, or what it should
 * have been instead — and its own report lags the site by days to weeks, so
 * "3,753 pages not found" can equally mean "3,753 pages are broken" or "3,753
 * pages were fixed last Tuesday and Google has not looked again". Those need
 * opposite responses, and the report cannot tell them apart. This can: it asks
 * the live site.
 *
 * ── The three outcomes, and what each one is worth ─────────────────────────
 *
 *   `resolved`  — answers 200 now. Nothing to do but tell Google to look
 *                 again, which is the Validate Fix button, not a code change.
 *                 After the closed-jobs fix this should be the bulk of any
 *                 export taken before it shipped.
 *
 *   `redirect`  — lands somewhere real. Already handled; listed so a wrong
 *                 destination is visible rather than assumed.
 *
 *   `gone`      — still 404. These are the only rows that need a decision, and
 *                 the script makes it cheaper by guessing: for a dead
 *                 `/jobs/<slug>`, it scores the slug against every live slug in
 *                 the sitemap and proposes the best match above a threshold.
 *                 Old-app slugs were usually the same title with a different
 *                 suffix, so a lot of them do match, and each match recovered
 *                 is ranking signal that would otherwise be thrown away.
 *
 * ── Order of operations ────────────────────────────────────────────────────
 * Run this against a deployment that already resolves closed listings. Run it
 * before that and more than half the export is a false `gone`, the proposals
 * are built from those, and a 301 laid over a page that was about to start
 * working again is the one mistake here that cannot be undone by fixing the
 * underlying bug.
 *
 * ── Why the suggestions are printed rather than applied ────────────────────
 * A wrong 301 is worse than a 404. It tells Google two different recruitments
 * are the same page, and unlike a 404 it never self-corrects. So the output is
 * a `next.config.ts` block to read and paste, with the match score against each
 * line, and the threshold is deliberately set where a human still has to look.
 *
 * ── Cost ───────────────────────────────────────────────────────────────────
 * One request per URL, capped at eight in flight. A 10,000-row export is
 * 10,000 edge requests against Vercel Hobby's million a month, and every one
 * of them is a static 404 or a CDN hit — no function invocation, no Supabase
 * read, nothing that touches the Supabase egress budget. Ten thousand rows
 * take roughly four minutes.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *   node scripts/audit-404s.mjs <export.csv|urls.txt> [--limit N] [--out DIR] [--site ORIGIN]
 *
 * Accepts the CSV Search Console exports (any sheet — it finds the column
 * holding URLs) or a plain newline-delimited list. Writes a markdown report
 * and, when there is anything to propose, a redirects snippet.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { basename, join } from "node:path";

/**
 * The origin to probe, and why it is not `NEXT_PUBLIC_SITE_URL`.
 *
 * That variable is `http://localhost:3000` in any shell that has sourced
 * `.env.local`, which is most shells this would be run from. Reading it would
 * mean the script quietly probes a dev server, reports every production URL as
 * gone, and proposes a page of redirects built from a local database. Defaulting
 * to production and taking an explicit `--site` is the version that cannot do
 * that by accident. The origin is printed on every run for the same reason.
 */
const DEFAULT_SITE = "https://www.jobstrackr.in";
const CONCURRENCY = 8;

/** The origin actually probed. Set once in `main`, from `--site` or the default. */
let SITE = DEFAULT_SITE;

/**
 * How close a dead slug must be to a live one before it is worth proposing.
 *
 * Token overlap, not string distance: `ssc-cgl-2026-notification` and
 * `ssc-cgl-2026-apply-online` are the same recruitment and are far apart by
 * edit distance, while `iit-madras-consultant-2026` and
 * `iit-madras-consultant-2026-2` are different recruitments and are adjacent.
 * Overlap gets both right.
 *
 * 0.72 was chosen against this site's slugs: below it the proposals are mostly
 * different posts from the same department, which is exactly the wrong 301 to
 * make. It is a floor for *showing* a suggestion, not for accepting one.
 */
const MATCH_THRESHOLD = 0.72;

/** Slug words that carry no identity — every third listing has them. */
const STOPWORDS = new Set([
  "recruitment",
  "notification",
  "apply",
  "online",
  "out",
  "for",
  "and",
  "the",
  "posts",
  "post",
  "vacancy",
  "vacancies",
  "form",
  "last",
  "date",
  "walkin",
  "walk",
  "in",
]);

/* ── Input ─────────────────────────────────────────────────────────────── */

/**
 * Pulls URLs out of whatever Search Console produced.
 *
 * The exports are not one shape: the Pages report, the per-issue drill-down and
 * the Performance report all differ in column order and header text, and some
 * are quoted while others are not. Rather than encode a schema that will change
 * the next time the console is redesigned, this takes anything that looks like
 * a URL on this origin, wherever it appears.
 */
function extractUrls(text) {
  const found = new Set();
  for (const match of text.matchAll(/https?:\/\/[^\s",<>]+/g)) {
    const raw = match[0].replace(/[.,);]+$/, "");
    let url;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    // Other origins in an export are referrers and examples, not this site's
    // pages. Auditing them would produce confident findings about somebody
    // else's server.
    if (url.hostname.replace(/^www\./, "") !== new URL(SITE).hostname.replace(/^www\./, "")) {
      continue;
    }
    url.hash = "";
    found.add(url.href);
  }
  return [...found];
}

/* ── Probing ───────────────────────────────────────────────────────────── */

/**
 * GET, not HEAD.
 *
 * Next serves a 404 page as a real document, and some CDN configurations
 * answer HEAD from a different path than GET — so HEAD can report a status the
 * page does not actually have. The body is discarded immediately; the cost is
 * bandwidth on a 404 page, which is a few kilobytes.
 */
async function probe(url) {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "jobstrackr-404-audit (+https://www.jobstrackr.in)" },
    });
    await response.arrayBuffer();

    const redirected = response.url !== url;
    return {
      url,
      status: response.status,
      finalUrl: redirected ? response.url : null,
      verdict:
        response.status === 200
          ? redirected
            ? "redirect"
            : "resolved"
          : response.status >= 500
            ? "error"
            : "gone",
    };
  } catch (error) {
    return {
      url,
      status: 0,
      finalUrl: null,
      verdict: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Bounded fan-out. A pool rather than batches, so one slow URL stalls one worker. */
async function probeAll(urls, onProgress) {
  const results = [];
  let cursor = 0;

  async function worker() {
    while (cursor < urls.length) {
      const index = cursor++;
      results[index] = await probe(urls[index]);
      onProgress(results.filter(Boolean).length, urls.length);
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, urls.length) }, worker));
  return results;
}

/* ── Matching a dead slug to a live one ────────────────────────────────── */

function tokens(slug) {
  return new Set(
    slug
      .split("-")
      .filter((word) => word.length > 1 && !STOPWORDS.has(word))
      // A trailing `-2` is how the old importer disambiguated a re-post. It is
      // the single most common difference between an old slug and its
      // survivor, and it carries no meaning.
      .filter((word) => !/^\d$/.test(word)),
  );
}

/** Jaccard overlap. Symmetric, so a long slug cannot swallow a short one. */
function similarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Every live URL the sitemap advertises, as a path → token-set index. */
async function loadLiveSlugs() {
  const response = await fetch(`${SITE}/sitemap.xml`);
  if (!response.ok) throw new Error(`sitemap.xml returned ${String(response.status)}`);

  const xml = await response.text();
  const index = new Map();

  for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const path = new URL(match[1]).pathname;
    const parts = path.split("/").filter(Boolean);
    if (parts.length !== 2) continue; // Only `/jobs/<slug>` and friends.
    const [section, slug] = parts;
    if (!index.has(section)) index.set(section, []);
    index.get(section).push({ slug, tokens: tokens(slug) });
  }

  return index;
}

function bestMatch(index, path) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length !== 2) return null;

  const [section, slug] = parts;
  const candidates = index.get(section);
  if (!candidates) return null;

  const dead = tokens(slug);
  let best = null;

  for (const candidate of candidates) {
    const score = similarity(dead, candidate.tokens);
    if (!best || score > best.score) best = { slug: candidate.slug, score, section };
  }

  return best && best.score >= MATCH_THRESHOLD ? best : null;
}

/* ── Report ────────────────────────────────────────────────────────────── */

function reportMarkdown(results, proposals, source) {
  const counts = results.reduce(
    (acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] ?? 0) + 1 }),
    {},
  );
  const gone = results.filter((r) => r.verdict === "gone");
  const errors = results.filter((r) => r.verdict === "error");

  const lines = [
    `# 404 audit — ${basename(source)}`,
    "",
    `Probed ${String(results.length)} URLs against ${SITE} on ${new Date().toISOString().slice(0, 10)}.`,
    "",
    "| Outcome | Count | What to do |",
    "| --- | --- | --- |",
    `| Resolved (200) | ${String(counts.resolved ?? 0)} | Nothing. Hit **Validate Fix** in Search Console. |`,
    `| Redirected | ${String(counts.redirect ?? 0)} | Nothing, unless a destination below looks wrong. |`,
    `| Still gone | ${String(counts.gone ?? 0)} | Redirect the ones worth recovering; leave the rest to drop out. |`,
    `| Errored | ${String(counts.error ?? 0)} | Re-run these — a 5xx or a timeout is not a verdict. |`,
    "",
  ];

  if (proposals.length > 0) {
    lines.push(
      "## Proposed redirects",
      "",
      "**Run this audit only against a deployment that already has the",
      "closed-jobs fix.** Before that fix, every expired listing 404s, so this",
      "section will happily propose redirecting each one at a *different* live",
      "job that shares its department and year — and once those 301s are in",
      "place the real page cannot come back, because its own URL now points",
      "somewhere else. Check `/jobs/<any expired slug>` returns 200 first.",
      "",
      "**Then read every line before pasting.** A wrong 301 merges two different",
      "recruitments in Google's index and, unlike a 404, never self-corrects.",
      "The score is token overlap between the dead slug and the live one;",
      "anything under ~0.85 is worth opening both pages to check. Scores of",
      "1.00 are not exempt: identical tokens in a different order, or an",
      "`-online`/`-offline` pair, both score 1.00 and are different postings.",
      "",
      "```ts",
      ...proposals.map(
        (p) =>
          `{ source: "${p.from}", destination: "${p.to}", permanent: true }, // ${p.score.toFixed(2)}`,
      ),
      "```",
      "",
    );
  }

  const unmatched = gone.filter(
    (r) => !proposals.some((p) => p.from === new URL(r.url).pathname),
  );
  if (unmatched.length > 0) {
    lines.push(
      `## Still gone, no confident match (${String(unmatched.length)})`,
      "",
      "These are fine to leave. A 404 is a correct answer for a page that never",
      "existed or should not come back, and Google drops them from the index on",
      "its own within a few crawls — the report entry clears itself.",
      "",
      ...unmatched.slice(0, 200).map((r) => `- \`${new URL(r.url).pathname}\``),
      unmatched.length > 200 ? `- …and ${String(unmatched.length - 200)} more` : "",
      "",
    );
  }

  if (errors.length > 0) {
    lines.push(
      `## Errored (${String(errors.length)})`,
      "",
      ...errors
        .slice(0, 50)
        .map((r) => `- \`${r.url}\` — ${r.error ?? `HTTP ${String(r.status)}`}`),
      "",
    );
  }

  return lines.filter((line) => line !== "").join("\n") + "\n";
}

/* ── Entry point ───────────────────────────────────────────────────────── */

const USAGE =
  "usage: node scripts/audit-404s.mjs <export.csv|urls.txt> " +
  "[--limit N] [--out DIR] [--site ORIGIN]";

/**
 * Consumes each flag with its value, so the positional argument is what is
 * left over. Scanning for "the first argument not starting with --" instead
 * reads the *value* of a flag as the filename whenever a flag comes first —
 * `--site https://x export.csv` would try to open `https://x`.
 */
function parseArgs(argv) {
  const flags = { limit: Infinity, out: ".", site: DEFAULT_SITE };
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--limit") flags.limit = Number(argv[(i += 1)]);
    else if (arg === "--out") flags.out = argv[(i += 1)];
    else if (arg === "--site") flags.site = argv[(i += 1)];
    else if (arg.startsWith("--")) throw new Error(`unknown flag ${arg}\n${USAGE}`);
    else positional.push(arg);
  }

  if (positional.length !== 1) throw new Error(USAGE);
  if (!Number.isFinite(flags.limit) && flags.limit !== Infinity) {
    throw new Error(`--limit must be a number\n${USAGE}`);
  }

  return { source: positional[0], ...flags };
}

async function main() {
  const { source, limit, out: outDir, site } = parseArgs(process.argv.slice(2));
  SITE = site.replace(/\/$/, "");

  console.log(`Auditing against ${SITE}`);

  const text = await readFile(source, "utf8");
  const urls = extractUrls(text).slice(0, limit);

  if (urls.length === 0) {
    console.error(`No ${SITE} URLs found in ${source}.`);
    process.exit(1);
  }

  console.log(`Probing ${String(urls.length)} URLs (${String(CONCURRENCY)} at a time)…`);
  const results = await probeAll(urls, (done, total) => {
    if (done % 50 === 0 || done === total) {
      process.stdout.write(`\r  ${String(done)}/${String(total)}`);
    }
  });
  process.stdout.write("\n");

  const index = await loadLiveSlugs();
  const proposals = [];
  for (const result of results) {
    if (result.verdict !== "gone") continue;
    const path = new URL(result.url).pathname;
    const match = bestMatch(index, path);
    if (match)
      proposals.push({ from: path, to: `/${match.section}/${match.slug}`, score: match.score });
  }
  proposals.sort((a, b) => b.score - a.score);

  await mkdir(outDir, { recursive: true });
  const reportPath = join(outDir, "404-audit.md");
  await writeFile(reportPath, reportMarkdown(results, proposals, source));

  const counts = results.reduce(
    (acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] ?? 0) + 1 }),
    {},
  );
  console.log(
    `resolved ${String(counts.resolved ?? 0)} · redirect ${String(counts.redirect ?? 0)} · ` +
      `gone ${String(counts.gone ?? 0)} · error ${String(counts.error ?? 0)}`,
  );
  console.log(`${String(proposals.length)} redirects proposed → ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
