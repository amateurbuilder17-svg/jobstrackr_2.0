# JobsTrackr — Ground-Up Rebuild Plan

**Status:** M0 complete · M1 blocked on the Supabase project · **Written:** 24 Aug 2026

> Canonical, always-current version: the published plan artifact.
> This file is the in-repo copy.

---

## 0. Urgent: the current production project is switched off

A live check against the Supabase project in the old `.env` returns **HTTP 402** on
every endpoint, including `/auth/v1/health`:

> `Service for this project is restricted due to the following violations: exceed_egress_quota.`

This is not a warning — the REST API, Auth and Storage are all hard-blocked. The
live site cannot load data or sign anyone in right now. The rebuild is therefore
also the recovery path, and one thing has to happen before code: **get the data out
of the old project** (see §7, Q1).

---

## 0.5 Decided

| | |
|---|---|
| **Framework** | Next.js App Router — 16.3.2 · React 19.2.8 · TypeScript 6.0.3 · Tailwind 4.3.3 |
| **Old data** | Export via the dashboard SQL Editor — see [`DATA-EXPORT.md`](DATA-EXPORT.md) |
| **Scope** | Every feature survives. The brief is faster and clearer, not fewer. |
| **Pace** | Sequential, with review at M2, M5, M8, M12 |

Two version pins that look like mistakes but are not:

- **TypeScript 6.0.3, not 7.0.2** — `typescript-eslint` does not support TS 7 yet, and
  type-aware linting is a gate here.
- **ESLint 9.39.5, not 10.9.0** — `eslint-plugin-react`, pulled in by
  `eslint-config-next`, calls an API ESLint 10 removed and crashes on load.

Both revert to latest once upstream catches up.

### M0 status — gate passed

`pnpm verify` runs typecheck, lint, format, tests, build and budget, and comes back
green. Both routes prerender static at **134.2 kB** first-load JS. The budget gate was
verified by deliberately adding an oversized client import: `/` rose to 261.2 kB and CI
failed, while `/_not-found` stayed clean — so the check is genuinely per-route.

Outstanding for M0: linking the Vercel project and pushing to GitHub, both of which
need accounts that do not exist yet.

---

## 1. Why it broke — root causes, not symptoms

The old app's data flow is: *download the entire `jobs` table into the browser, then
filter, search, score and rank it in JavaScript.* Every feature is built on that
assumption, so every fix so far has been a cache layer bolted over it.

| # | Root cause | Evidence | Cost |
|---|---|---|---|
| 1 | **Whole-table fetch.** `useJobs` / `/api/cache/jobs` select ~5,200 rows with `.range(0, 9999)`. | `src/hooks/useJobs.ts:71`, `api/cache/[key].ts` | ~8.8 MB JSON per pull; the single biggest egress line item |
| 2 | **No pagination anywhere.** No cursor, no `LIMIT`, no server-side filter. | same | list, search and feed all pay full-table cost |
| 3 | **Matching runs in the browser.** A 65 KB `jobMatcher.ts` + `hybridScorer` + client-side cosine similarity need every row present to work. | `src/lib/jobMatcher.ts`, `src/hooks/useFeed.ts` | forces cause #1 to exist |
| 4 | **Admin bypasses the cache.** `bypassCache` pulls all jobs, uncached, per mount. | `src/hooks/useJobs.ts:79-96` | ~14 MB per admin session |
| 5 | **Search is client-side JS** over 5,200 in-memory rows. | `src/lib/jobSearch.ts` | no Postgres FTS index exists |
| 6 | **Hand-rolled SSR for SEO** — a serverless function per crawler hit on `/jobs/:slug`, `/updates/:slug`, `/exam-update/:slug`, `/sitemap.xml`. | `api/jobs/[slug].ts` + `vercel.json` rewrites | crawler traffic → function invocations + Supabase reads |
| 7 | **Bundle bloat.** 3.2 MB of JS: 806 KB `transformers.js` (an ML model **in the browser**), 310 KB Lottie, 312 KB Admin chunk. | `dist/assets/` | slow first paint, high Vercel bandwidth |
| 8 | **A 601 KB single source file.** `src/pages/Admin.tsx`. | `src/pages/Admin.tsx` | unmaintainable, unreviewable, un-splittable |
| 9 | **Dead weight in the repo.** A whole second Vite app (`exam-compass-main/`), stale `dist/`, `graphify-out/`, `__pycache__/`, a 434 KB `eligibility_data.json`, duplicate `jobMatcher_v3.ts` at root. | repo root | build time, confusion, review noise |
| 10 | **Two parsers kept in sync by hand** — `apps-script/Html.gs` and `api/lib/scraper_v5.py`. | — | recurring scraper bugs |

**The fix is not a better cache. It is: never send a row the screen will not render.**

---

## 2. Target architecture

### The one principle

> Every byte that leaves Supabase must be a byte the user actually sees — and it
> should leave Supabase once, not once per visitor.

### Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js App Router** (latest stable, pinned at scaffold) | Server Components mean data is fetched on the server and only rendered HTML reaches the browser. Streaming + Suspense give progressive loading for free. |
| Rendering | **Static by default + on-demand revalidation** | The decisive lever. Pages render once, live on Vercel's CDN, and are re-rendered only when the ingest pipeline says the data changed. Supabase reads decouple from traffic entirely. |
| Data | **Supabase Postgres** with FTS (`tsvector` + GIN), keyset pagination, RPCs for matching | Search and scoring move into the database where the indexes are. |
| Client state | React Query, **only for user-owned mutable data** (saved, profile, tracker) | Public content never touches the client cache — it is already HTML. |
| Styling | Tailwind + shadcn/ui on a real token system | Keeps the look, drops the ad-hoc CSS. |
| Auth | Supabase Auth via SSR cookies | Session available in Server Components; no auth flash. |
| Ingestion | Apps Script → Sheet → a single `/api/sync` worker | Retires the Python serverless functions. |

### The egress model

```
              ┌───────────────────────────────────────────┐
  visitor ──▶ │ Vercel CDN  (static HTML + RSC payload)   │ ── 99% of traffic stops here
              └────────────────┬──────────────────────────┘
                               │ only on a revalidate signal
              ┌────────────────▼──────────────────────────┐
              │ Next.js render  (Server Components)       │
              └────────────────┬──────────────────────────┘
                               │ narrow, indexed, LIMITed queries
              ┌────────────────▼──────────────────────────┐
              │ Supabase Postgres                         │
              └───────────────────────────────────────────┘
                               ▲
   Apps Script → Sheet → /api/sync ──┘ then POST /api/revalidate (tagged)
```

Traffic no longer drives Supabase reads. **Data changes** drive Supabase reads.

### Projected monthly Supabase egress (free tier = 5 GB)

| Path | Assumption | Est. / month |
|---|---|---|
| List & landing pages | ~40 static routes × 30 KB × 4 revalidations/day | ~145 MB |
| Job detail pages | ~30 changed/day × 8 KB (initial 5,200-page backfill ≈ 42 MB, one-off) | ~10 MB |
| Server-side search | 20k queries × 16 KB (card columns only, `LIMIT 20`) | ~320 MB |
| Signed-in reads | 10k sessions × ~5 KB | ~50 MB |
| Admin (paginated, 50/page) | realistic daily use | ~100 MB |
| Ingest writes + reconciliation | — | ~150 MB |
| **Total** | | **≈ 0.8 GB — 16% of quota** |

Roughly **6× headroom**, versus today's overrun. Every number above is enforced by a
budget test in Module 12, not left to trust.

---

## 3. Feature triage

### Cut — no discussion needed

| Item | Reason |
|---|---|
| `transformers.js` in-browser embeddings (806 KB) | Embeddings belong in Postgres/`pgvector`, computed once at ingest. |
| Lottie runtime (310 KB) | Replaceable with CSS/SVG at ~2 KB. |
| `exam-compass-main/` | A second, unrelated Vite app living inside the repo. |
| `dist/`, `graphify-out/`, `__pycache__/`, `*.pyc`, `bun.lockb` + `package-lock.json` both | Build junk and lockfile ambiguity. |
| Root strays: `jobMatcher_v3.ts`, `usage_v3.ts`, `ScrollRestoration1.tsx`, `eligibility_data.json`, `test_parse_date.py`, `quiz.html` | Superseded duplicates. |
| Hand-rolled SSR functions in `api/*` | Replaced by the framework. |
| Redis as a *data* cache | The CDN does this job better and free. Redis stays only if we need rate limiting. |
| Splash screen | Adds startup latency to hide startup latency. |

### Keep — the core product

Home feed · Jobs list + search + filters · Job detail · Saved jobs · Profile &
education · My Exams tracker · Exam calendar · Exam updates · For You
recommendations · Admin · SEO surface (sitemap, JSON-LD, OG)

### Needs your call — see §7, Q2

Govt Job Quiz · Syllabus Finder · Application Guide (FormMate) · Document upload +
OCR · Countdown Wall / Share / Live · Telegram alerts · Facebook auto-posting ·
AI job search · Trending page · PWA install prompt + offline mode

Each of these carries real weight — code, tables, RLS policies, storage, and in
several cases its own egress. I would rather ship six features that feel flawless
than eighteen that feel approximate.

---

## 4. The modules

Each module is independently shippable and ends at a gate. **A module is not done
until its gate passes** — that is what keeps "enterprise grade" from being a
sentiment.

### M0 · Foundation & guardrails
Scaffold Next.js + TypeScript `strict` + Tailwind + shadcn. ESLint/Prettier, Husky,
`.env` schema validated with Zod at boot (the app refuses to start on a missing
key). CI: typecheck, lint, test, build, bundle-size budget. Vercel project linked.
**Gate:** empty app deploys green; CI fails on a deliberately oversized import.

### M1 · Data platform
New Supabase project. Schema written fresh, not inherited: narrow typed columns,
`jobs` split so hot card fields are separate from cold detail JSON, `tsvector`
search column with a GIN index, keyset-friendly indexes, `pgvector` for embeddings,
RLS on every table with deny-by-default. Migrations in `supabase/migrations/`,
generated types checked in. Import of the old data.
**Gate:** `EXPLAIN ANALYZE` on every read path shows an index scan; RLS test suite
proves an anonymous user cannot read another user's row.

### M2 · Data access layer & caching contract
`server-only` query modules — the only place Supabase is touched. Every function
takes an explicit column list and a `LIMIT`. Cursor pagination helper. Cache tags
per entity (`job:<slug>`, `jobs:list`, `updates:list`) and the `/api/revalidate`
endpoint that invalidates them. A lint rule forbidding `select('*')`.
**Gate:** a test asserts every exported query has a `LIMIT` and no `select('*')`
exists in the codebase.

### M3 · Design system & app shell
Tokens (colour, type scale, spacing, radius, elevation, motion) for light and dark.
Core primitives. The shell: sidebar, top bar, bottom nav, command palette. Skeletons
that match final layout exactly so nothing shifts. Route prefetch on intent, view
transitions, focus management, reduced-motion support. WCAG AA.
**Gate:** CLS < 0.02 on every shell route; keyboard-only walkthrough of the shell
passes; axe reports zero violations.

### M4 · Jobs — list, search, filters
Server-rendered list, 20 per page, keyset pagination, streamed in with Suspense.
Filters and search live in the URL (shareable, back-button-correct) and execute as
Postgres FTS + indexed predicates. Infinite scroll via a server action that returns
the next slice only.
**Gate:** first page TTFB < 200 ms warm; payload for 20 cards < 25 KB; searching
`"ssc"` runs one indexed query, not a table scan.

### M5 · Job detail & SEO
Statically generated per slug, revalidated on change. JSON-LD `JobPosting`, OG
images generated at the edge, canonical URLs, streamed sitemap, `robots.txt`.
301s from every old URL shape so nothing loses its ranking.
**Gate:** Lighthouse SEO 100; a crawler hitting 1,000 job pages triggers **zero**
Supabase queries.

### M6 · Auth & profile
Supabase Auth over SSR cookies, middleware-protected routes, no auth flash. Profile,
education, sector preferences — server actions with Zod validation on both sides.
**Gate:** session survives refresh; protected route server-redirects with no client
flicker; RLS blocks cross-user writes in tests.

### M7 · Saved jobs & My Exams tracker
Optimistic mutations with rollback. Guest-mode local state that merges cleanly on
first sign-in.
**Gate:** save/unsave feels instantaneous offline and reconciles correctly on
reconnect.

### M8 · For You — server-side matching
The old 65 KB browser matcher becomes a Postgres function: hard eligibility filters
in SQL, ranking over precomputed job features, optional `pgvector` re-ranking
against a profile embedding computed at ingest. Returns the top 50, card columns
only. Precision-first — accurate or absent, never a loose guess.
**Gate:** RPC p95 < 150 ms; response < 40 KB; a fixture suite of profile→job cases
passes with no false "eligible".

### M9 · Exam updates & calendar
Updates list and detail (static + tagged revalidation). Calendar with fixed-width
month grid, event sheets, ICS export. The `exam_updates.job_id` link gets populated
properly at ingest, so job pages stop paying a title-similarity fallback scan.
**Gate:** calendar grid does not reflow across breakpoints; every update row has a
resolved `job_id` or an explicit null.

### M10 · Admin
A separate route group behind a role check, never in the public bundle. Server-side
paginated tables, 50 rows per page — the 14 MB refetch is structurally impossible.
Job/update editors, ingest run monitor, egress dashboard.
**Gate:** a full admin session stays under 5 MB of total Supabase egress.

### M11 · Ingestion pipeline
One `/api/sync` worker: reads the Apps Script feed, diffs, upserts changed rows
only, recomputes derived fields and embeddings, then fires tagged revalidation.
Idempotent, resumable, with a dead-letter table for failed rows so nothing needs
manual requeueing. Scheduling from Apps Script time-triggers (Vercel Hobby allows
only 2 crons, daily — see §6). The duplicated parser gets one source of truth.
**Gate:** a re-run over unchanged data writes zero rows; a poisoned row lands in the
dead-letter table without stalling the batch.

### M12 · Observability, hardening, cutover
Sentry, structured logs, Web Vitals, and a synthetic egress budget check in CI.
Rate limiting on writes. Security headers and a CSP with no `unsafe-eval`. Load test
against the free-tier ceilings. Then: data migration, DNS, redirect verification,
and a rollback plan.
**Gate:** a simulated month of traffic stays inside every free-tier limit with
margin; every old URL resolves 200 or 301.

### Suggested order

M0 → M1 → M2 → M3 → **M4 → M5 (first user-visible slice, deployable)** → M6 → M7 →
M11 (data starts flowing) → M8 → M9 → M10 → M12.

M4+M5 is the first point where you have a real, fast, deployable site. I would
recommend we ship that publicly before continuing.

---

## 5. Accounts to create

### Required now

| Service | What to do | Notes |
|---|---|---|
| **Supabase** | New organisation + new project. Region **ap-south-1 (Mumbai)**. | Free tier = 2 active projects per org, 5 GB egress, 500 MB DB, 50k MAU. A new org restarts the quota. Keep the old project's org separate so its restriction does not follow you. |
| **Vercel** | New account (or new team) + new project. Region **bom1**. | Hobby: 100 GB bandwidth, 1M edge requests, 1M invocations, **2 cron jobs at daily granularity only**. |
| **GitHub** | New empty repo, e.g. `jobstrackr`. | Vercel deploys from it; CI gates run on it. Start clean rather than importing the old history. |

### Recommended

| Service | Why | Cost |
|---|---|---|
| **Sentry** | Without it, production errors are invisible. This is the one "optional" I would not skip. | Free: 5k errors/mo |
| **Cloudflare** (domain + proxy) | Absorbs crawler and bot traffic before it reaches Vercel — directly protects the edge-request budget. | Free |

### Only if we keep the matching features

| Service | Needed for |
|---|---|
| **Upstash Redis** | Rate limiting write endpoints. *Not* data caching any more. Free: 500k commands/mo |
| **Groq / Gemini** | AI summarisation, AI search. You already have keys. |
| **Telegram Bot** | Alerts, if kept. You already have a token. |
| **Google account** | Apps Script + Sheets ingestion. Already in place. |

### One thing to be aware of

Vercel's Hobby plan is licensed for non-commercial use. If the site carries ads or
any monetisation, that is a Pro-plan situation. Flagging it as a fact so it is your
decision, not a surprise later.

---

## 6. Constraints we are designing against

| Limit | Value | How the design stays inside it |
|---|---|---|
| Supabase egress | 5 GB/mo | Static-first rendering; narrow selects; server-side search. Est. 0.8 GB. |
| Supabase DB | 500 MB | Cold JSON split out; no embeddings duplicated; log tables auto-pruned. |
| Supabase MAU | 50k | Fine at current scale. |
| Vercel bandwidth | 100 GB/mo | Target < 250 KB JS per route; images served as AVIF/WebP; immutable asset caching. |
| Vercel invocations | 1M/mo | Static pages invoke nothing. Only mutations and revalidation cost invocations. |
| **Vercel cron** | **2 jobs, daily** | Ingestion is triggered by **Apps Script time-triggers** (free, every 15 min) posting to `/api/sync`. Vercel's 2 crons are reserved for the daily reconcile + prune. |
| Function duration | 100 GB-hrs | Sync is incremental and batched; no long-running scrape on Vercel. |

---

## 7. Questions I need answered

**Q1 — Getting the old data out.** *Answered:* the dashboard works, so the export runs
through the **SQL Editor**. Procedure in [`DATA-EXPORT.md`](DATA-EXPORT.md).
*Still needed from you:* the output of the two sizing queries at the top of that file,
whether the Storage tab loads, and whether you still have the old database password.

**Q2 — Feature scope.** *Answered:* everything stays, rebuilt faster and clearer. I am
carrying that same answer across the five features the question had no room for — Govt
Job Quiz, Application Guide, Document upload + OCR, AI job search, PWA install +
offline. Veto any of them and I will drop it; otherwise they are in the M1 schema.

**Q3 — Users.** Roughly how many registered users and daily actives does the old app
have? It changes whether we optimise for 500 or 50,000, and whether losing the user
tables in Q1(c) is survivable.

**Q4 — Domain.** Same domain as today, or a new one? If the same, we need every old
URL pattern mapped to a 301 before cutover so search rankings survive.

**Q5 — Framework.** *Answered:* Next.js App Router. Scaffolded and building.

**Q6 — Pace.** *Answered:* sequential, with review at M2, M5, M8, M12.

---

## 8. What already exists in this workspace

```
jobstrackr-new/
├── .env.local          ← fill this in (annotated, per-key instructions)
├── .env.example        ← committed template, no values
├── .gitignore
└── docs/
    └── REBUILD-PLAN.md ← this file
```

No code has been written yet — that starts at M0, once §7 is answered.
