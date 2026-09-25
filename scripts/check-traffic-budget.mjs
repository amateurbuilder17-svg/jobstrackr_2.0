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
  // Vercel Hobby, under Fluid compute. These two are how function *time* is
  // metered now, and this file modelled neither until the SEO worker made
  // duration a thing this project spends — an `after()` callback runs inside
  // its route's budget, so it is billed as that route running for longer.
  //
  // Active CPU is CPU actually consumed; waiting on a database or an HTTP call
  // does not count towards it. Provisioned Memory is memory reserved times
  // wall-clock time, so I/O waiting is exactly what it does count. Nearly
  // everything this app does is waiting, which is why the two projections
  // below come out an order of magnitude apart.
  vercelActiveCpuHours: 4,
  vercelProvisionedGbHours: 360,
  // ── The two ceilings that actually broke ────────────────────────────────
  // Everything above was modelled from the start and none of it was what went
  // wrong. The Hobby project blew up on ISR Writes (744K against 200K) and Fast
  // Origin Transfer (13.4 GB against 10), neither of which appeared in this
  // file — so the check went on printing a comfortable pass through the month
  // it was billed for. See 949face.
  //
  // They are here now because they are the ceilings this architecture can
  // actually reach: both are driven by how often a page *re-renders*, and this
  // is a project with ~13,000 statically generated pages whose whole design is
  // that they should not.
  vercelIsrWrites: 200_000,
  vercelFastOriginTransferGb: 10,
};

// Hobby functions are 2 GB / 1 vCPU, fixed — not configurable on this plan.
// Provisioned Memory is therefore 2 GB times however long a function runs.
const FUNCTION_MEMORY_GB = 2;

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
  //
  // Scaled by 13,475 / 9,722 for the closed-jobs fix. The prerendered count
  // itself did not move — closed listings are not prerendered — but the
  // sitemap grew by 39%, and this line is a proxy for crawler appetite across
  // the whole advertised corpus rather than for the prerendered set alone.
  // The pages that appetite lands on which actually cost something are
  // counted separately, in `closedJobRendersPerMonth` below.
  crawlerPagesPerMonth: Math.round(694 * 8 * (13475 / 9722)),
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
  // Closed job pages rendering on demand.
  //
  // New with the closed-jobs fix. `getJobBySlug` now resolves `status =
  // 'closed'`, restoring ~3,753 URLs from a 404 to a real page — but
  // `listJobSlugsForBuild` still prerenders published rows only, deliberately,
  // because prerendering 3,753 frozen pages pays a build-time Supabase read
  // for pages nobody may visit. So these are the one part of the public corpus
  // that is NOT free to crawl: a request that misses the cache renders, and
  // `cacheLife("content")` lets that happen at most daily per page.
  //
  // ── How this number is derived, and the trap in deriving it ──────────────
  // The obvious figure is 3,753 × 8 — the whole set, at the same twice-weekly
  // recrawl `crawlerPagesPerMonth` assumes. That is 30,024 renders, it pushes
  // Active CPU to 55%, and it is wrong in a way worth writing down: it charges
  // 3,753 closed pages with four times more crawler attention than this file
  // gives the entire 9,722-URL sitemap. `crawlerPagesPerMonth` is not "the
  // corpus, eight times" — it is the *prerendered* count, eight times, used as
  // a proxy for total crawler appetite precisely because a crawler does not
  // walk a whole sitemap twice a week.
  //
  // So it is derived the same way the rest of the file is. Crawler fetches
  // scale with the corpus: the sitemap grows 9,722 → ~13,475, so total fetches
  // grow by the same 39%, and closed pages take their share of that by count
  // (3,753 / 13,475 ≈ 28%). Spread over 3,753 pages those fetches average less
  // than one apiece a month, so essentially every one of them misses a
  // one-day-old cache and renders — which is why the share is charged in full
  // rather than discounted again.
  //
  // Still the pessimistic end: `/sitemaps/jobs.xml` marks these `yearly` at priority
  // 0.3, and crawl rate falls off hard for pages described that way.
  //
  // This is the line to watch if the free tier gets tight. The fix if it does
  // is not to re-hide the pages — a closed listing is frozen by definition, so
  // it can hold a far longer cache profile than `content`, which would take
  // this to roughly one render per page per month.
  closedJobRendersPerMonth: Math.round(694 * 8 * (13475 / 9722) * (3753 / 13475)),
  // Sitemap rebuilds. Bounded by the CDN window, not by crawler appetite: a
  // CDN region rebuilds a child sitemap at most once per `SITEMAP_CDN_SECONDS`
  // window however often crawlers ask. This counts the job file, the one big
  // child — the page file is a few kilobytes on a day's window, and there is
  // no update file since update pages stopped asking to be indexed — rebuilt
  // every six hours in four regions. Four is the pessimistic end: Googlebot and
  // Bingbot both crawl from the US, with only the long tail from Europe. Each
  // rebuild reads `sitemapRegenerationKb` and ships `sitemapXmlKb` from the
  // function to the CDN.
  //
  // It was 30 * 24, "at most hourly, on invalidation". That was the design,
  // and it never ran: on Vercel the prerendered `sitemap.ts` was a static file
  // that changed only on deploy (measured 25 Sep 2026, `lib/seo/sitemap-xml.ts`).
  // The model priced rebuilds the system was not doing.
  sitemapRegenerationsPerMonth: 4 * 4 * 30,
  // Update detail pages rendering on demand.
  //
  // The same class of cost as `closedJobRendersPerMonth`, and it was missing
  // from this file rather than absent from the system: `listExamUpdateSlugsForBuild`
  // prerenders `BUILD_PRERENDER_LIMIT` (100) slugs and the other ~5,200 render
  // on first request, exactly as closed job pages do. Found while doing the
  // arithmetic for the rails, and modelled here rather than left implicit.
  //
  // Derived the same way: updates are ~3,000 of the ~13,475 URLs the sitemap
  // advertises, so they take ~22% of total crawler fetches.
  updateRendersPerMonth: Math.round(694 * 8 * (13475 / 9722) * (3000 / 13475)),
  // Rail cache entries repopulating.
  //
  // This is the line that decides whether the rails are affordable, so the
  // reasoning matters more than the figure.
  //
  // The two category rails take no per-page argument, so `"use cache"` gives
  // all ~5,300 update pages ONE shared entry each — see `listLatestInCategory`.
  // The job rail is keyed on the organisation acronym from `relationTerm`, so
  // it has one entry per distinct term rather than per page. 400 terms is the
  // pessimistic end of that: the acronyms are a few hundred at most, and every
  // SSC update in the corpus shares one.
  //
  // Each entry repopulates when it goes stale and something asks for it. The
  // `content` profile revalidates every three days, so ten times a month; that
  // is tripled to cover deployments, which start the cache empty.
  //
  // The number to hold on to is what this would have cost done the obvious
  // way. Keying either rail on the current page's slug — which is what
  // excluding "this update" from its own rail naively requires — turns 402
  // cache entries into ~5,300 and this line into a Supabase egress figure
  // roughly thirteen times larger. The exclusion happens after the cache
  // instead, in `pickRailRows`, where it is free.
  railRefreshesPerMonth: 30,
  distinctJobRailTerms: 400,
  // Hub pages re-rendering (`src/lib/hubs/catalog.ts`): states, categories,
  // organisations, and the /jobs/page/n and /updates/page/n archives.
  //
  // Time-based and never tag-purged, so this is bounded by the calendar, not
  // by crawler appetite or by ingest: page 1 of a hub is on the `hub` profile
  // (two days, 15 windows a month), every later page on `hubArchive` (seven
  // days, ~4.3). Charged as though a crawler arrives after every window and
  // the list changed every time — the ceiling. An unchanged re-render writes
  // nothing, which is most small hubs most weeks.
  //
  // First pages: 37 state and 26 category hubs from the catalogue, 339
  // organisations with three or more items (measured on /organisations the
  // day hubs shipped, 22 Sep 2026; estimated at 250 before), and the two
  // archives. Deeper pages: ~7,900 indexable items (the 22 Sep 2026 sitemap)
  // sitting in ~3 hubs each — a state, a sector or level, an employer — plus
  // the archives, fifty a page, less the first pages already counted. The
  // archives alone measured 80 pages each.
  hubFirstPages: 37 + 26 + 339 + 2,
  hubDeepPages: Math.round((7900 * 4) / 50) - (37 + 26 + 339 + 2),
  hubCensusRefreshesPerMonth: 15,
};

/** Hub renders a month, at the ceiling described above. */
const hubRendersPerMonth = Math.round(
  TRAFFIC.hubFirstPages * (30 / 2) + TRAFFIC.hubDeepPages * (30 / 7),
);

/* ── Measured payloads, in kilobytes ───────────────────────────────────── */
const PAYLOAD = {
  // Heaviest route, gzipped: first-load JS from `pnpm budget` (174.7, /tracker)
  // plus the document below, because a cold visitor pays for both and this line
  // is the only one they are counted on.
  //
  // 178 → 201. Both halves were remeasured when the update rails landed, and
  // both had drifted: first-load JS is 174.7 kB rather than the 159.9 this line
  // was written against, and the document figure below moved further still.
  // Neither drift was caused by the rails — /tracker is the heaviest route and
  // nothing here touched it — but a model fed stale inputs cannot answer the
  // question it exists to answer, so they are corrected in the same commit that
  // noticed.
  pageFirstLoadKb: 201,
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
  //
  // 18 → 26, remeasured by gzipping every prerendered `.html` in `.next/server/
  // app` — which is document plus inlined RSC flight payload, i.e. what the CDN
  // actually ships. Two separate movements are folded into that number and they
  // should not be confused with each other:
  //
  //   • /jobs/[slug] measures 25.9 kB (max) / 25.1 (mean) and NOTHING in this
  //     commit touched it. The 18 was simply years stale.
  //   • /updates/[slug] measures 24.8 / 23.8 with the share row, the CTA, the
  //     two update rails and the job rail; the same build with those four
  //     blocks removed measures 20.4 / 19.6. So the rails cost +4.2 kB gzipped
  //     on the mean, about +21%, and the page is still lighter than the job
  //     page it sits beside.
  //
  // 26 is the heavier of the two, rounded up. It is the right figure to model
  // because crawler traffic is overwhelmingly detail pages.
  pageDocumentKb: 26,
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
  // Brand artwork: the home splash and the credential screens. Pre-encoded
  // AVIF served as static files, so this is Vercel bandwidth and nothing else
  // — it never reaches Supabase and it never invokes a function.
  //
  // Measured from `public/brand` after `node scripts/build-brand-art.mjs`:
  // a cold `/` fetches the ridge band and the emblem (5.9 + 7.0 kB) and a cold
  // `/sign-in` the artwork and the emblem (14.5 + 7.0 kB at desktop widths,
  // 5.6 + 7.0 on a phone). 22 is the heavier of the two, which is the one to
  // model.
  //
  // It is deliberately NOT folded into `pageFirstLoadKb`: these are immutable
  // files on their own URLs, so a visitor fetches them once and every
  // subsequent view — including every other route — costs nothing.
  brandArtKb: 22,
  // The SEO worker's own reads, per run: two `seo_ping_state` rows, then a
  // slug and a timestamp for each candidate row. Modelled at the full
  // `CAPS.indexNowPerRun` batch of 500 across the two content tables at ~90
  // bytes a row — which is the backfill, not the steady state, where a run
  // finds a handful of changed listings or none at all. The receipt written to
  // `seo_ping_log` is smaller again.
  //
  // The outbound POSTs are not counted here: those bytes go to Bing and
  // Google, not to Supabase, and at 500 URLs the IndexNow body is ~35 kB
  // against a 100 GB Vercel transfer allowance.
  seoWorkerKb: 45,
  // One job detail page rendering: the `detailQuery` join — the job row, its
  // `job_details` row and the organization — plus the change log and the
  // related-jobs rail. `STORED.jobs` and `STORED.jobDetails` put the two hot
  // rows at 5.5 + 4.4 kB; the rails add a handful of card rows on top.
  jobDetailRenderKb: 12,
  // One job-sitemap rebuild: a slug, an `updated_at` and a status for every
  // job page that asks to be indexed, plus the per-request overhead of the
  // paged round trips it takes.
  //
  // 820 → 565 on 25 Sep 2026, and measured rather than estimated this time:
  // the 3,963 job slugs in that day's live sitemap average 68 characters,
  // which as PostgREST's JSON is ~565 kB uncompressed. Update pages left the
  // sitemap that day, and their read with them. The old figure's "~60 bytes a
  // row" had been low for the job rows alone.
  //
  // This line did not exist while the query was silently truncated to 1,000
  // rows a table by Supabase's `max_rows` — the read was a fifth of this size
  // and the sitemap was a fifth of the site. Paging past the cap is what makes
  // the sitemap complete, and this is what that costs.
  sitemapRegenerationKb: 565,
  // The XML one job-sitemap rebuild sends to the CDN, which Vercel meters as
  // Fast Origin Transfer. Measured on 25 Sep 2026: the 3,963 job entries in
  // the live sitemap came to 891,254 bytes. The sitemap was a static file then
  // and cost no origin transfer at all; a sitemap that refreshes does, and
  // this is that price.
  sitemapXmlKb: 870,
  // One update detail page rendering: the `UPDATE_DETAIL_SELECT` join — the
  // update row plus its `exam_update_details` row, which carries the five JSONB
  // columns that made the old table 39 MB — plus the sibling rail. `STORED`
  // puts the pair at 4.8 + 6.6 kB; the rails are counted separately below
  // because they are shared between pages and this is not.
  updateDetailRenderKb: 13,
  // One category rail repopulating: twelve update *card* rows, which is the
  // narrow select — no JSONB, no detail join — at ~0.5 kB a row.
  updateRailKb: 6,
  // One job rail repopulating: twelve job card rows at the ~0.74 kB a row that
  // `forYouRpcKb` measures (33.3 kB / 46 rows).
  jobRailKb: 9,
  // One hub page rendering: fifty rows of slug, title, two dates, status and
  // the employer's name — no JSONB, no detail join. ~0.3 kB a row, rounded up
  // for organisation hubs, whose page n reads n × 50 rows from two tables to
  // merge them.
  hubRenderKb: 20,
  // The census behind the hub indexes and the sitemap's hub entries: four
  // narrow columns over every indexable job and update, ~8,000 rows.
  hubCensusKb: 1000,
};

/* ── Function time, per invocation ─────────────────────────────────────── */
// Seconds. `wall` is what Provisioned Memory bills; `cpu` is what Active CPU
// bills, and the gap between them is time spent waiting on Supabase, Gemini or
// an indexing endpoint.
//
// UNLIKE the payload figures above, these are ESTIMATES rather than
// measurements — this project has no production traffic to measure yet. They
// are deliberately pessimistic, and the honest way to read the result is "two
// orders of magnitude of headroom, so the estimate would have to be wrong by
// 100x to matter", not "3.4% is the true figure". Replace them with real
// numbers from Vercel Observability once there are any.
const TIMING = {
  // A page of matched jobs plus the session read: several Supabase round trips,
  // very little computation.
  personalisedRoute: { wall: 0.4, cpu: 0.15 },
  adminRoute: { wall: 0.5, cpu: 0.25 },
  // The ingest batch: diff, upsert, detail writes, revalidation.
  syncRun: { wall: 4, cpu: 0.6 },
  // The SEO worker, as an `after()` callback on the sync invocation above.
  // Modelled at its hard ceiling (RUN_BUDGET_MS = 8s) rather than at the ~0.5s
  // a steady-state run takes, because the worst case is what a budget is for:
  // this is the backfill, and a run that spends its whole allowance every hour
  // for a month.
  seoWorker: { wall: 8, cpu: 0.1 },
  // An LLM call with Google Search grounding. Ten to twenty seconds of waiting
  // and almost no local work — the single largest line in the wall-clock
  // column, and nearly absent from the CPU one.
  statusRefresh: { wall: 15, cpu: 0.3 },
  // A job detail page rendering cold: one join, one change-log read, two rail
  // reads, then React. Mostly waiting on Supabase, like every other read here.
  closedJobRender: { wall: 0.5, cpu: 0.2 },
  // An update detail page rendering cold. Slightly more waiting than a job
  // page — the detail join, the sibling rail, and three rail reads that are
  // usually cache hits and are charged here as though they never are.
  updateRender: { wall: 0.6, cpu: 0.2 },
  // One or two narrow list queries, then fifty rows of markup.
  hubRender: { wall: 0.5, cpu: 0.2 },
  serverAction: { wall: 0.3, cpu: 0.2 },
  // IndexNow's verifier fetching /<key>.txt. One env read and a string.
  indexNowKeyFetch: { wall: 0.05, cpu: 0.02 },
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
  totalPageViews * 0.75 * PAYLOAD.pageDocumentKb +
  // Counted against every cold visit, which over-counts on purpose: a crawler
  // walking 5,552 job pages fetches the artwork on none of them, and the
  // splash only renders on `/`. Being wrong in this direction is the point of
  // the exercise.
  totalPageViews * 0.25 * PAYLOAD.brandArtKb;

// Supabase egress: only what actually reaches the database. Static pages are
// served from the CDN and cost nothing here — that is the entire architecture,
// and this line is where it shows up.
const supabaseKb =
  TRAFFIC.personalisedSessionsPerMonth * (PAYLOAD.forYouRpcKb + PAYLOAD.sessionPayloadKb) +
  TRAFFIC.adminSessionsPerMonth * PAYLOAD.adminSessionKb +
  TRAFFIC.syncRunsPerMonth * PAYLOAD.syncRunKb +
  TRAFFIC.syncRunsPerMonth * PAYLOAD.seoWorkerKb +
  TRAFFIC.sitemapRegenerationsPerMonth * PAYLOAD.sitemapRegenerationKb +
  TRAFFIC.closedJobRendersPerMonth * PAYLOAD.jobDetailRenderKb +
  TRAFFIC.updateRendersPerMonth * PAYLOAD.updateDetailRenderKb +
  // The rails. Two shared category entries, plus one per organisation acronym.
  TRAFFIC.railRefreshesPerMonth * 2 * PAYLOAD.updateRailKb +
  TRAFFIC.railRefreshesPerMonth * TRAFFIC.distinctJobRailTerms * PAYLOAD.jobRailKb +
  hubRendersPerMonth * PAYLOAD.hubRenderKb +
  TRAFFIC.hubCensusRefreshesPerMonth * PAYLOAD.hubCensusKb +
  TRAFFIC.personalisedSessionsPerMonth * PAYLOAD.trackerPageKb +
  (TRAFFIC.statusRefreshesPerMonth + TRAFFIC.statusCronCallsPerMonth) * PAYLOAD.statusRefreshKb;

// Invocations: prerendered pages do not invoke. Personalised routes, API
// routes, sync runs and the closed job pages — which are the one part of the
// public corpus that is not prerendered — do.
const invocations =
  TRAFFIC.closedJobRendersPerMonth +
  TRAFFIC.updateRendersPerMonth +
  hubRendersPerMonth +
  TRAFFIC.personalisedSessionsPerMonth * 6 +
  TRAFFIC.adminSessionsPerMonth * 8 +
  TRAFFIC.syncRunsPerMonth +
  TRAFFIC.statusRefreshesPerMonth +
  TRAFFIC.statusCronCallsPerMonth +
  humanPageViews * 0.1 + // server actions: saves, form posts
  // The SEO worker adds NO invocation of its own — it is an `after()` callback
  // on the sync request, which is the whole reason it was put there. What it
  // does add is IndexNow's verifier fetching the key file, at most once per
  // submission.
  TRAFFIC.syncRunsPerMonth;

// Function time. Wall-clock seconds bill Provisioned Memory; CPU seconds bill
// Active CPU. The SEO worker appears in both columns as an addition to the sync
// invocation rather than as an invocation of its own.
const functionSeconds = (pick) =>
  TRAFFIC.closedJobRendersPerMonth * TIMING.closedJobRender[pick] +
  TRAFFIC.updateRendersPerMonth * TIMING.updateRender[pick] +
  hubRendersPerMonth * TIMING.hubRender[pick] +
  TRAFFIC.personalisedSessionsPerMonth * 6 * TIMING.personalisedRoute[pick] +
  TRAFFIC.adminSessionsPerMonth * 8 * TIMING.adminRoute[pick] +
  TRAFFIC.syncRunsPerMonth * (TIMING.syncRun[pick] + TIMING.seoWorker[pick]) +
  (TRAFFIC.statusRefreshesPerMonth + TRAFFIC.statusCronCallsPerMonth) *
    TIMING.statusRefresh[pick] +
  humanPageViews * 0.1 * TIMING.serverAction[pick] +
  TRAFFIC.syncRunsPerMonth * TIMING.indexNowKeyFetch[pick];

const activeCpuHours = functionSeconds("cpu") / 3600;
const provisionedGbHours = (functionSeconds("wall") / 3600) * FUNCTION_MEMORY_GB;

/* ── ISR writes, and the failure mode they encode ──────────────────────── */
// A page writes an ISR entry when a request finds no fresh copy and re-renders
// one. So the ceiling is reached in one of two ways, and they behave completely
// differently:
//
//   Traffic-driven. A request arrives, the page's own `content` window has
//   elapsed, it re-renders. Bounded by requests — you cannot write more entries
//   than you are asked for — and that bound is the reassuring one: ~15K
//   requests a month cannot produce 744K writes no matter how stale everything
//   is.
//
//   Invalidation-driven. `revalidateTag` marks a whole *set* of pages stale at
//   once, and the next request to each one rewrites it. This is unbounded by
//   traffic in the way that matters: ingest purges `updates:list` up to four
//   times an hour, so a detail page that reads a query carrying that tag is
//   stale again within minutes of every render, and every single crawler visit
//   becomes a write. ~7,000 detail pages behaving that way is exactly how this
//   project reached 744K.
//
// The second term is zero here by construction, not by luck: no query a detail
// page awaits carries a collection tag, and `detail-page-tags.test.ts` fails
// the build if one ever does. It is written out rather than omitted so that the
// number is visible, and so that anyone who reintroduces the bug can see what
// it costs before the invoice does.
const staleOnArrival =
  // Crawler fetches spread over ~13,475 URLs average well under one per page
  // per month, so essentially every one lands on a page whose three-day window
  // has long since passed. Charged in full.
  TRAFFIC.crawlerPagesPerMonth +
  // Human traffic concentrates on the handful of pages that stay warm.
  humanPageViews * 0.1 +
  // Every hub re-render is charged as a write; see `hubRendersPerMonth`.
  hubRendersPerMonth;

// What the pre-949face architecture would cost at this traffic: every detail
// page stale again within minutes of each render, so every request to one is a
// write. Kept as a live expression rather than a comment so it cannot drift.
const DETAIL_PAGE_SHARE = 0.85; // of crawler traffic; the corpus is detail pages
const isrWritesIfListTagged =
  staleOnArrival + TRAFFIC.crawlerPagesPerMonth * DETAIL_PAGE_SHARE * 4;

const isrWrites = staleOnArrival;

/* ── Fast Origin Transfer ──────────────────────────────────────────────── */
// Bytes leaving the origin — a function rendering a response — as opposed to
// bytes served from the edge cache, which are ordinary bandwidth. Every ISR
// write ships a document, and so does every on-demand render. So does every
// sitemap rebuild: the children are route handlers the CDN caches, not files.
const fastOriginKb =
  (isrWrites + TRAFFIC.updateRendersPerMonth) * PAYLOAD.pageDocumentKb +
  TRAFFIC.sitemapRegenerationsPerMonth * PAYLOAD.sitemapXmlKb;

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
  "Vercel active CPU": {
    value: activeCpuHours,
    limit: LIMITS.vercelActiveCpuHours,
    unit: "CPU-hr",
  },
  "Vercel provisioned memory": {
    value: provisionedGbHours,
    limit: LIMITS.vercelProvisionedGbHours,
    unit: "GB-hr",
  },
  "Vercel ISR writes": {
    value: isrWrites,
    limit: LIMITS.vercelIsrWrites,
    unit: "",
  },
  "Fast origin transfer": {
    value: fastOriginKb / KB_PER_GB,
    limit: LIMITS.vercelFastOriginTransferGb,
    unit: "GB",
  },
};

/* ── Report ────────────────────────────────────────────────────────────── */
// Margin below which this fails. A projection at 90% of a ceiling is not a
// pass — it is a single good week away from an outage.
const MARGIN = 0.5;

console.log("");
console.log(
  `  ${"Resource".padEnd(26)} ${"Projected".padStart(13)} ${"Limit".padStart(11)}   Used`,
);
console.log(`  ${"─".repeat(26)} ${"─".repeat(13)} ${"─".repeat(11)}   ────`);

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
    `${over ? "✗" : " "} ${name.padEnd(26)} ${shown.padStart(13)} ${cap.padStart(11)}   ${(ratio * 100).toFixed(1)}%`,
  );
}
console.log(
  `  ISR writes if a detail page carried a list tag: ` +
    `${Math.round(isrWritesIfListTagged).toLocaleString("en-IN")} ` +
    `(${((isrWritesIfListTagged / LIMITS.vercelIsrWrites) * 100).toFixed(0)}% of the ceiling).\n` +
    `  Held at zero by the tags in src/lib/db/tags.ts, enforced by\n` +
    `  src/lib/db/queries/detail-page-tags.test.ts.\n`,
);

/* ── The assumption this file is least sure of ─────────────────────────── */
// `crawlerPagesPerMonth` is a proxy — the prerendered page count times eight —
// and production has already contradicted it. 949face records 744K ISR writes
// billed in one month. Under the tagging of the time a detail page was stale
// again within minutes of each render, so writes tracked crawler fetches almost
// one for one: that figure is not a modelling artefact, it is a measurement of
// crawler appetite, and it is ~95x what the line above assumes.
//
// This scenario re-runs the two re-render ceilings against that evidence. It
// does NOT gate the build, because the number is inferred rather than read off
// a dashboard and because the ceiling it moves is one nothing in this commit
// touches — the rails do not change how often a page re-renders, only how many
// bytes it ships when it does. It prints because the alternative is a check
// that reports a comfortable pass using an input the billing history disproves,
// which is the exact failure this file was written to prevent.
const OBSERVED_CRAWLER_FETCHES = 744_000;
const CACHE_WINDOWS_PER_MONTH = 30 / 3; // `content` revalidates every three days
const SITEMAP_URLS = 13_475;

// Post-949face a page rewrites at most once per window however often it is
// crawled, so the realistic figure is bounded by the corpus, not by fetches.
const isrWritesObserved = Math.min(
  OBSERVED_CRAWLER_FETCHES,
  SITEMAP_URLS * CACHE_WINDOWS_PER_MONTH,
);
const originGbObserved = (isrWritesObserved * PAYLOAD.pageDocumentKb) / KB_PER_GB;
const isrRatio = isrWritesObserved / LIMITS.vercelIsrWrites;
const originRatio = originGbObserved / LIMITS.vercelFastOriginTransferGb;

console.log(
  `  ── Scenario: crawler traffic at the volume 949face actually billed ──\n` +
    `  ISR writes           ${Math.round(isrWritesObserved).toLocaleString("en-IN").padStart(9)}` +
    ` / ${LIMITS.vercelIsrWrites.toLocaleString("en-IN")}   ${(isrRatio * 100).toFixed(0)}%\n` +
    `  Fast origin transfer ${originGbObserved.toFixed(2).padStart(9)} GB / ` +
    `${String(LIMITS.vercelFastOriginTransferGb)} GB   ${(originRatio * 100).toFixed(0)}%\n` +
    `  Bounded by the corpus rather than by fetches: the three-day window caps\n` +
    `  each page at ${String(CACHE_WINDOWS_PER_MONTH)} rewrites a month. Raising \`content\`'s revalidate is the\n` +
    `  lever if this gets tight — it divides both lines directly.\n`,
);

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
