#!/usr/bin/env node
/**
 * Models a month of traffic against every free-tier ceiling.
 *
 * The old project did not die of a bug. It died of arithmetic nobody did: a
 * 6 kB row, times 5,231 rows, times every page view, against a 5 GB egress
 * quota. By the time the 402 arrived the site had been down for hours.
 *
 * This is that arithmetic, as a build step. The inputs are measured rather
 * than guessed — each one is annotated with where the number came from — and
 * the check fails when a projection crosses a ceiling, so the answer arrives
 * in review instead of in a billing email.
 *
 * It is a model, not a promise. It cannot know a crawler will discover the
 * site next Tuesday. What it can do is make the assumptions explicit and
 * refuse to let them drift silently.
 */

/* ── Ceilings ──────────────────────────────────────────────────────────── */
const LIMITS = {
  supabaseEgressGb: 5, // Supabase free tier
  supabaseDbMb: 500, // Supabase free tier
  vercelBandwidthGb: 100, // Vercel Hobby
  vercelInvocations: 1_000_000, // Vercel Hobby
  vercelEdgeRequests: 1_000_000, // Vercel Hobby
};

/* ── Traffic ───────────────────────────────────────────────────────────── */
// From the plan §0.5: 99 registered users, ~30 daily. Crawler traffic is the
// larger and less predictable half, so it is modelled generously.
const TRAFFIC = {
  dailyActiveUsers: 30,
  pageViewsPerUser: 8,
  daysPerMonth: 30,
  // A search engine recrawling the whole corpus, twice a week. 694 is the
  // prerendered page count from the last build, not a guess.
  //
  // 448 → 694 when the countdown landed (M27): every job with a closing date
  // gained a shareable /countdown/[slug] page. That is a 55% larger corpus for
  // a crawler to walk, and it is the reason this number is remeasured on every
  // module rather than set once.
  crawlerPagesPerMonth: 694 * 8,
  // Signed-in sessions that hit the personalised routes.
  personalisedSessionsPerMonth: 30 * 30,
  adminSessionsPerMonth: 60,
  syncRunsPerMonth: 30 * 24, // hourly Apps Script trigger
  // Exam-status refreshes. The per-user ceiling is 10/day, but the cache is
  // shared by subject and most looks are answered from it, so this models the
  // ones that reach the route at all: roughly one per personalised session.
  // The nightly cron adds its own fixed batch.
  statusRefreshesPerMonth: 30 * 30,
  statusCronCallsPerMonth: 30 * 6,
};

/* ── Measured payloads, in kilobytes ───────────────────────────────────── */
const PAYLOAD = {
  // Heaviest route, gzipped: first-load JS from `pnpm budget` (159.9) plus the
  // document below, because a cold visitor pays for both and this line is the
  // only one they are counted on.
  pageFirstLoadKb: 178,
  // Repeat views reuse the chunk cache; only the document is refetched.
  //
  // 14 → 18 for the app menu (M21). The drawer's contents are server-rendered
  // into the shell, so every page now carries the menu's markup twice — once as
  // HTML and once in the RSC payload that hydrates it. Measured across the
  // whole build: +1.8 kB gzipped on a list page, +4.0 kB on a job detail page,
  // and +30% on the total bytes the CDN holds (13.3 → 17.3 MB).
  //
  // That is the price of the drawer costing ~2 kB of JavaScript instead of
  // shipping fifty links as a client component, and at this traffic it buys
  // more than it costs — but it is a real number and it belongs here rather
  // than in a commit message. 18 is the heaviest document, not the mean;
  // crawler traffic is mostly detail pages, so the heavy one is the one to
  // model.
  pageDocumentKb: 18,
  // Measured in M30: one `match_feed()` call against the 6,000-job proof corpus,
  // serialised as PostgREST would send it — 46 rows, 33.3 kB.
  //
  // It went DOWN. The page used to make two calls: `match_jobs(50)` at 30.4 kB
  // and `match_jobs_blocked(20)` at 14.7 kB, which is 45.1 kB and two round
  // trips for two of the four tiers. One call returns all four, its own
  // counters, and the `qualification_summary` the cards were previously
  // rendering as undefined — because the per-tier caps (36/12/12/10) are
  // tighter than 50 + 20 was.
  //
  // Database time is 38.4 ms against the pair's 25.3 ms, best of three on the
  // same corpus: the tiering has to evaluate every open job to know which ones
  // fail exactly one test, where `match_jobs` can stop at the eligibility
  // index. One fewer Vercel-to-Supabase round trip buys that back several
  // times over.
  forYouRpcKb: 34,
  // Measured in M10: a full admin session, overview + 6 pages + storage.
  adminSessionKb: 98,
  // Measured in M7 as /api/saved; now /api/session, which also carries the
  // display name, address and admin flag for the profile button. The identity
  // block adds ~0.12 kB to the response and two small reads behind it — a
  // one-column profile select and the has_role RPC — against a request the
  // session was already making.
  sessionPayloadKb: 4.2,
  // A sync run reads the feed and writes only what changed; the read is the
  // Apps Script side, so what counts here is the diff query plus writes.
  syncRunKb: 60,
  // One exam-status refresh against Supabase: the attempt with its joins, the
  // cached report, the quota claim, the upsert. The model call itself is
  // Google's bandwidth, not Vercel's or Supabase's.
  statusRefreshKb: 12,
  // The tracker's own read: one page of attempts plus their cached reports.
  trackerPageKb: 18,
};

/* ── Stored rows ───────────────────────────────────────────────────────── */
// `supabaseDbMb` was declared as a ceiling from the first version of this file
// and then never checked — a limit nothing verifies is a limit that is not
// really there, and this is the one the old project actually hit second.
//
// Bytes per row are measured, not guessed: `pg_total_relation_size / n_live_tup`
// on a seeded database, so each figure already includes that table's indexes
// and its toast. Row counts are the production corpus from the plan (§0.4:
// ~5,200 indexed job pages, 99 accounts).
const STORED = {
  jobs: { rows: 5200, bytesPerRow: 5530 },
  jobDetails: { rows: 5200, bytesPerRow: 4437 },
  examUpdates: { rows: 3000, bytesPerRow: 4779 },
  examUpdateDetails: { rows: 3000, bytesPerRow: 6599 },
  // Carries a 384-dimension embedding, which is most of the row.
  profiles: { rows: 99, bytesPerRow: 12288 },
  examAttempts: { rows: 500, bytesPerRow: 19661 },
  // Ops and log tables are pruned nightly by /api/cron/prune, so they are
  // modelled at a steady state rather than growing without bound.
  opsAndLogs: { rows: 5000, bytesPerRow: 2000 },
};

const KB_PER_GB = 1024 * 1024;

/* ── Projection ────────────────────────────────────────────────────────── */
const humanPageViews =
  TRAFFIC.dailyActiveUsers * TRAFFIC.pageViewsPerUser * TRAFFIC.daysPerMonth;
const totalPageViews = humanPageViews + TRAFFIC.crawlerPagesPerMonth;

// Vercel bandwidth: every page view, human or crawler. First load for a
// quarter of them (new visitors, cold cache), document only for the rest.
const vercelKb =
  totalPageViews * 0.25 * PAYLOAD.pageFirstLoadKb +
  totalPageViews * 0.75 * PAYLOAD.pageDocumentKb;

// Supabase egress: only what actually reaches the database. Static pages are
// served from the CDN and cost nothing here — that is the entire architecture,
// and this line is where it shows up.
const supabaseKb =
  TRAFFIC.personalisedSessionsPerMonth * (PAYLOAD.forYouRpcKb + PAYLOAD.sessionPayloadKb) +
  TRAFFIC.adminSessionsPerMonth * PAYLOAD.adminSessionKb +
  TRAFFIC.syncRunsPerMonth * PAYLOAD.syncRunKb +
  TRAFFIC.personalisedSessionsPerMonth * PAYLOAD.trackerPageKb +
  (TRAFFIC.statusRefreshesPerMonth + TRAFFIC.statusCronCallsPerMonth) * PAYLOAD.statusRefreshKb;

// Invocations: static pages do not invoke. Personalised routes, API routes and
// sync runs do.
const invocations =
  TRAFFIC.personalisedSessionsPerMonth * 6 +
  TRAFFIC.adminSessionsPerMonth * 8 +
  TRAFFIC.syncRunsPerMonth +
  TRAFFIC.statusRefreshesPerMonth +
  TRAFFIC.statusCronCallsPerMonth +
  humanPageViews * 0.1; // server actions: saves, form posts

const storedMb =
  Object.values(STORED).reduce((sum, t) => sum + t.rows * t.bytesPerRow, 0) / (1024 * 1024);

const projection = {
  "Supabase egress": {
    value: supabaseKb / KB_PER_GB,
    limit: LIMITS.supabaseEgressGb,
    unit: "GB",
  },
  "Supabase database": {
    value: storedMb,
    limit: LIMITS.supabaseDbMb,
    unit: "MB",
  },
  "Vercel bandwidth": {
    value: vercelKb / KB_PER_GB,
    limit: LIMITS.vercelBandwidthGb,
    unit: "GB",
  },
  "Vercel invocations": {
    value: invocations,
    limit: LIMITS.vercelInvocations,
    unit: "",
  },
  "Edge requests": {
    value: totalPageViews,
    limit: LIMITS.vercelEdgeRequests,
    unit: "",
  },
};

/* ── Report ────────────────────────────────────────────────────────────── */
// Margin below which this fails. A projection at 90% of a ceiling is not a
// pass — it is a single good week away from an outage.
const MARGIN = 0.5;

console.log("");
console.log(
  `  ${"Resource".padEnd(20)} ${"Projected".padStart(12)} ${"Limit".padStart(10)}   Used`,
);
console.log(`  ${"─".repeat(20)} ${"─".repeat(12)} ${"─".repeat(10)}   ────`);

const breaches = [];
for (const [name, { value, limit, unit }] of Object.entries(projection)) {
  const ratio = value / limit;
  const over = ratio > MARGIN;
  if (over) breaches.push({ name, value, limit, unit, ratio });

  const shown = unit
    ? `${value.toFixed(2)} ${unit}`
    : Math.round(value).toLocaleString("en-IN");
  const cap = unit ? `${String(limit)} ${unit}` : limit.toLocaleString("en-IN");
  console.log(
    `${over ? "✗" : " "} ${name.padEnd(20)} ${shown.padStart(12)} ${cap.padStart(10)}   ${(ratio * 100).toFixed(1)}%`,
  );
}
console.log("");

if (breaches.length > 0) {
  console.error(
    `✗ Traffic budget\n\n` +
      breaches
        .map(
          (b) =>
            `  • ${b.name} projected at ${(b.ratio * 100).toFixed(0)}% of its free-tier limit`,
        )
        .join("\n") +
      `\n\n  The threshold is ${String(MARGIN * 100)}% deliberately: a projection that only just\n` +
      `  fits leaves nothing for a traffic spike, and the old project's outage\n` +
      `  began as a month that "only just fit". Either reduce the payload or\n` +
      `  raise the assumption in this script — in a commit someone reviews.\n`,
  );
  process.exit(1);
}

console.log(
  `  ✓ A month of modelled traffic fits inside every free-tier ceiling with\n` +
    `    at least ${String((1 - Math.max(...Object.values(projection).map((p) => p.value / p.limit))) * 100).slice(0, 4)}% headroom on the tightest one.\n`,
);
