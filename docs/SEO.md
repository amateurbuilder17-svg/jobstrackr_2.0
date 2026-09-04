# Search and assistant visibility

How this site gets found, what it costs, and the two environment variables that
switch the push-indexing worker on.

Nothing here is optional-but-recommended hand-waving: the worker no-ops safely
with no credentials configured, so the site behaves correctly today. What
follows is what turns "a crawler will find it eventually" into "the engines are
told within the hour".

---

## What was already true

The rebuild's static architecture is itself the SEO story. Every job page is
prerendered and re-rendered only when its cache tag is invalidated, so a crawler
walking five thousand job pages reads five thousand static files and issues no
database query at all. That is why crawl volume is not a cost line here, and it
is why the rest of this document can be about reach rather than about budget.

On top of that:

| Surface | Where |
| --- | --- |
| `JobPosting` structured data on every listing | `src/lib/seo/job-jsonld.ts` |
| `Article` + `BreadcrumbList` on every exam update | `src/lib/seo/update-jsonld.ts` |
| `WebSite` + `Organization` + sitelinks search | `src/lib/seo/site-jsonld.ts` |
| Sitemap, regenerated on content change | `src/app/sitemap.ts` |
| Crawler rules, including the assistant crawlers | `src/app/robots.ts` |
| Orientation file for assistants | `src/app/llms.txt/route.ts` |
| 301s from every old URL shape | `next.config.ts` → `redirects()` |

## What the worker adds

Push indexing: telling the engines a URL changed instead of waiting to be
crawled. It runs from `after()` on `/api/sync`, so it needs **no Vercel cron**
and costs **no extra invocation**. The cron point is a cadence one, not a count
one: Hobby permits 100 cron jobs per project but each may only fire **once per
day**, and a worker that announces new listings once a day is barely worth
having. Ingestion already runs hourly from an Apps Script trigger, so riding on
it is both free and eight times more timely than the best cron Hobby offers.

```
Apps Script (hourly)
      │
      ▼
POST /api/sync ──► ingest ──► revalidateTag ──► response returned
                                                     │
                                                after() ──► SEO worker
                                                              ├─ IndexNow  (Bing, Yandex, Seznam, Naver)
                                                              └─ Google Indexing API  (job pages only)
```

`src/lib/seo/worker.ts` is the orchestration; the two clients beside it are the
protocols. `docs`-level summary of the design decisions lives in the migration,
`supabase/migrations/20260903000003_seo_worker.sql`.

### Why IndexNow is the ChatGPT answer

There is no "submit to ChatGPT" endpoint. ChatGPT's search feature answers from
Bing's index, and Copilot is Bing outright — so a job page that Bing learns
about within the hour is a job page an assistant can cite the same day.
IndexNow is how Bing is told. The same single POST reaches Yandex, Seznam and
Naver.

The other half of assistant visibility is `robots.txt`, which now names
`OAI-SearchBot` and `ChatGPT-User` (ChatGPT), `PerplexityBot`,
`ClaudeBot`/`Claude-SearchBot`, and `Google-Extended` (Gemini and AI
Overviews — separate from Googlebot, so allowing Googlebot alone leaves the AI
surfaces empty). Read the comment at the top of `src/app/robots.ts` before
editing it: a named `User-agent` block *replaces* the `*` block rather than
merging with it.

### Why Google's Indexing API only sees job pages

Google sanctions that endpoint for pages carrying `JobPosting` or
`BroadcastEvent` structured data and states that other use is grounds for
revoking access. `/jobs/*` qualifies. `/updates/*` does not and is never
submitted — `eligibleFor` in `src/lib/seo/targets.ts` enforces it, and a test
asserts it, because the revocation would be silent. Update pages reach Google
through the sitemap, which is the sanctioned route for them.

---

## The row cap, and why the sitemap is complete now

Supabase caps every API response at `max_rows` — 1,000, pinned in
`supabase/config.toml`. The cap is applied **server-side, after** the query's
own LIMIT, and it does not error: `.limit(20000)` silently returns a thousand
rows.

Four queries asked for 20,000. The live sitemap therefore listed exactly 1,000
jobs and exactly 1,000 updates out of a ~5,200 + ~3,000 corpus — Google was
being told about a fifth of the site, and nothing anywhere reported it, because
a truncated sitemap is a perfectly valid sitemap. It was found by counting the
URLs in the production file and noticing the number was suspiciously round. It
is invisible in development, where the seeded corpus is 240 jobs.

**Raising `max_rows` was the wrong fix.** It is global: lifting it to 20,000
raises the ceiling on every query the app makes, including any whose own LIMIT
is one refactor away from being absent. An accidental 20,000-row read of `jobs`
is ~30 MB of egress, which is the failure this rebuild exists to recover from.
The cap is a backstop worth keeping.

So the two sitemap queries page past it explicitly, via `fetchAllRows` in
`src/lib/db/paginate.ts`, ordered by `slug` — offset paging re-reads the table
per request, so the sort key must be unique or rows shuffle between pages and
get duplicated or dropped. `updated_at` is not unique; `slug` is.

**`generateStaticParams` stays capped, deliberately.** Prerendering is a cost
decision; discovery is the sitemap's job. A slug absent from the build list is
still in the sitemap, still crawlable, and still cached for thirty days after
its first request — one render, once. A slug *present* in it costs a render on
every deploy, and the job page reads the `job_details` JSONB at ~15 kB a time.
Across the two routes that call it, the full corpus would be ~10,400 renders
and ~150 MB per deploy — roughly 4.5 GB a month at thirty deploys, against a
5 GB ceiling. `BUILD_PRERENDER_LIMIT` in `src/lib/db/build-params.ts` is that
number, and it now says 1,000 rather than pretending to say 20,000.

Cost of the fix: the sitemap read goes from ~90 kB to ~520 kB per
regeneration, and regeneration is bounded by tag invalidation — at most hourly,
however often a crawler asks. That is the `Supabase egress` line moving from
2.8% to 9.9% of the free tier in the table above.

## Setup

### 1. IndexNow — five minutes, no account

```bash
openssl rand -hex 16
```

Set the result as `INDEXNOW_KEY` in Vercel → Settings → Environment Variables
(Production). Nothing else: the key file the protocol fetches is served by
`/api/seo/indexnow-key` through the `/:key.txt` rewrite in `next.config.ts`.

Verify after deploying:

```bash
curl -i https://jobstrackr.in/<your-key>.txt
```

A `200` with the key as the body means submissions will validate. A `404` means
the variable is not set in the environment being served.

### 2. Google Indexing API — twenty minutes, needs a Google account

1. In [Google Cloud Console](https://console.cloud.google.com), create a project
   (or reuse one) and enable **Indexing API**.
2. Create a **service account**, then create a **JSON key** for it and download
   it.
3. In [Search Console](https://search.google.com/search-console), open the
   `jobstrackr.in` property → Settings → Users and permissions → add the service
   account's email address as an **Owner**. This step is the one people skip;
   without it every submission returns `403 Permission denied`.
4. From the downloaded JSON, set two variables in Vercel:

   - `GOOGLE_INDEXING_CLIENT_EMAIL` — the `client_email` field.
   - `GOOGLE_INDEXING_PRIVATE_KEY` — the `private_key` field, pasted whole.
     The escaped `\n` sequences are expected and handled; see
     `normalizePrivateKey`.

Both must be present or the Google target stays switched off.

### 3. Kick off the first run

The worker runs on the next ingest by itself. To start immediately — or to
drain a backlog one batch at a time — call the manual lever:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://jobstrackr.in/api/seo/ping
```

The response body is the run result, which is also the fastest way to find out
whether the credentials work:

```json
{
  "indexnow": { "configured": true, "submitted": 500, "failed": 0, "watermark": "…" },
  "google":   { "configured": true, "submitted": 8,   "failed": 0, "watermark": "…" }
}
```

`"configured": false` with a `note` means that target's environment variables
are absent. That is a normal state, not a failure.

---

## How it behaves

**The watermark.** Each target stores one timestamp in `seo_ping_state`, and a
run asks for published rows whose `updated_at` is after it. Because
`content_hash` (migration 0015) means an unchanged re-ingest does not bump
`updated_at`, an unchanged row is never re-submitted. Because the watermark
reads the table rather than the ingest result, it also catches admin edits,
`merge_duplicate_jobs`, and any other write path.

**Failure recovery is "wait an hour".** A run that fails anywhere leaves the
watermark where it was, so the next run repeats the same work. There is no
retry queue and no dead-letter path to drain, deliberately.

**Backfill is paced.** The first run starts at the epoch, so the whole published
corpus is eligible. It goes out at `CAPS.indexNowPerRun` (500) and
`CAPS.googlePerRun` (8) per hourly run rather than all at once.

**The Google quota is counted, not hoped for.** The project allowance is 200
notifications a day; `CAPS.googleDaily` spends at most 180, leaving room for a
manual submission from Search Console. The count resets on UTC midnight, which
is Google's day, not IST.

## What it costs

Per run: two `seo_ping_state` reads, up to two indexed content queries returning
a slug and a timestamp per row, one IndexNow POST, up to eight Google POSTs, and
a bounded log insert. `scripts/check-traffic-budget.mjs` models it; the figures
below are the worker in isolation, at its **worst case** — the full 8-second
`RUN_BUDGET_MS` spent on every one of the 720 hourly runs in a month, which is
the backfill, not the steady state where most runs find nothing to submit.

| Vercel Hobby ceiling | Worker uses | Share |
| --- | --- | --- |
| Cron jobs (100/project, **once per day** each) | 0 | — |
| Function invocations (1,000,000) | 720 | 0.07% |
| Active CPU (4 CPU-hrs) | 0.02 CPU-hrs | 0.5% |
| Provisioned memory (360 GB-hrs) | 3.2 GB-hrs | 0.9% |
| Fast data transfer (100 GB) | 0.024 GB | 0.02% |
| Supabase egress (5 GB) | 0.031 GB | 0.6% |
| Supabase database (500 MB) | ~1 MB steady state | 0.2% |

The 720 invocations are **not** the worker — it adds none, being an `after()`
callback on a request that was happening anyway. They are IndexNow's verifier
fetching `/<key>.txt`, at most once per submission.

Provisioned memory is the largest line because Hobby functions are 2 GB and
that metric is memory times wall-clock time — and the worker is almost entirely
*waiting* on Bing and Google. That same fact is why Active CPU, which excludes
I/O wait, barely moves. The two new tables are one row per target plus a receipt
log pruned to 14 days by `prune_operational_data()`.

Whole-project projection, with the worker included, from `pnpm traffic`:

```
  Supabase egress                  0.50 GB        5 GB   9.9%
  Supabase database              102.05 MB      500 MB   20.4%
  Vercel bandwidth                 0.77 GB      100 GB   0.8%
  Vercel invocations                 9,120   1,000,000   0.9%
  Edge requests                     12,752   1,000,000   1.3%
  Vercel active CPU            0.53 CPU-hr    4 CPU-hr   13.3%
  Vercel provisioned memory    15.27 GB-hr   360 GB-hr   4.2%
```

Two caveats worth stating plainly rather than burying:

**The time figures are estimates, not measurements.** Every payload number in
that script is measured; the per-invocation `TIMING` block is not, because there
is no production traffic to measure yet. They are pessimistic on purpose, and
the safe reading is "the estimate would have to be wrong by 30x for active CPU
to bind", not "13.3% is the true figure". Replace them from Vercel Observability
once there is real data.

**Active CPU is the tightest ceiling, and the SEO worker is not what fills it.**
At 13.3% the pressure comes from the personalised routes and the exam-status
refreshes, not from push indexing's 0.5%. If that number ever becomes a problem,
this is not the feature to cut.

## Checking on it

```sql
-- Where each target has got to.
select * from public.seo_ping_state;

-- What has failed lately. The partial index on this table exists for this query.
select target, url, http_status, error, pinged_at
  from public.seo_ping_log
 where not ok
 order by pinged_at desc
 limit 20;
```

Common failures and what they mean:

| Target | Status | Cause |
| --- | --- | --- |
| indexnow | 403 | Key file not reachable, or `INDEXNOW_KEY` differs from the submitted key |
| indexnow | 422 | A URL in the batch is not on `NEXT_PUBLIC_SITE_URL`'s host |
| google | 403 | Service account is not an Owner of the Search Console property |
| google | 429 | Daily quota exhausted — `CAPS.googleDaily` should have prevented this |
| google | 400 | Malformed URL, or `GOOGLE_INDEXING_PRIVATE_KEY` newlines mangled |

## Things deliberately not done

**A `/countdown/[slug]` in the sitemap.** Those pages are blocking renders
(`instant = false`), so each crawl is a serverless invocation, and they restate
a date the job page already gives — thin, duplicated content competing with the
page that should rank. They are disallowed in `robots.txt` and stay shareable
by link.

**`URL_DELETED` notifications.** A job whose window shuts becomes `closed`
rather than disappearing, and the page stays up as a record of what was
advertised. Telling Google to drop a URL that still returns 200 is a request it
is right to ignore.

**A queue table.** The obvious design is a row per pending URL with a trigger on
`jobs`. It is unbounded storage against a 500 MB ceiling that must be pruned
correctly forever. The watermark is one row per target and derives the same
answer from a column that already exists.

**Enumerating listings in `llms.txt`.** That file is an orientation document,
not an inventory; the inventory is `sitemap.xml`, which is already incremental
and already correct. Duplicating it would give the two a way to disagree.
