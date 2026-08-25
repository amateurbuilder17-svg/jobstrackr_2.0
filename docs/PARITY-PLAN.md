# Parity plan — the four surfaces, and the accounts

The rebuild has the architecture. What it does not yet have is the *product*:
the old app's job page knew everything about a notification, its home page was a
feed, its For You page explained itself, and its updates page was searchable and
filterable. This plan brings those four across — not by porting the components,
which were 55 kB of `lucide-react` and a browser-side matcher, but by rebuilding
each one under the rules in [`REBUILD-PLAN.md`](REBUILD-PLAN.md) §2.

Modules continue the existing numbering. Same contract as before: **a module is
not done until its gate passes.**

---

## 0. What the audit found

Five things came out of reading both codebases side by side. Two are live bugs,
one is a blocker sitting under two of the four surfaces, and two are features
that were built and then never wired to anything.

### 0.1 · The updates filter navigates to the wrong page — *fix today*

`FilterChips` hardcodes its destination:

```ts
// src/components/jobs/filter-chips.tsx:39
router.replace(next.toString() ? `/jobs?${next.toString()}` : "/jobs", { scroll: false });
```

It has exactly one caller — `/updates` — so **tapping "Results" on the exam
updates page navigates you to the jobs list** with `?category=result`, which
`/jobs` then ignores. The category filter on that page has never worked.

Fix: derive the destination from `usePathname()` rather than baking it in.
`FilterBar` and `SearchField` carry the same hardcoded `/jobs` and must be made
route-agnostic in the same change, before they get a second caller in M15.

### 0.2 · Nothing writes `job_details` — the blocker

`JOB_DETAIL_SELECT` (`src/lib/db/queries/jobs.ts:47`) pulls the whole cold half
of a listing:

```
detail:job_details ( description, eligibility_text, experience_text,
  apply_link, official_website, notification_pdf,
  important_dates, application_fees, vacancies_detail,
  selection_process, overview )
```

The ingestion worker writes `jobs`, `organizations` and `job_changes` — and
nothing else (`src/lib/sync/ingest.ts`, payload ends at line 135). **The table is
empty and has always been empty.** Every one of those fields renders as absent,
which is why the current detail page looks thin: not a design decision, a
missing writer.

This is the blocker under M14 (job detail) and half of M16 (home). It is fixed
first, in M13.

### 0.3 · `min_qualification_level` is never populated — For You is empty for everyone

`match_jobs` treats it as a hard filter, correctly:

```sql
-- supabase/migrations/20260824000011_matching.sql:204
and j.min_qualification_level is not null
```

`required_stream` is a *generated* column and therefore cannot drift — that was
the right call and the migration says why. `min_qualification_level` is a plain
column, and the only writer that could fill it, the ingest worker, does not.
So the predicate is `null is not null` on every row: **`/for-you` returns zero
matches for every user, no matter how complete their profile is.** The page's
empty state ("Nothing open matches you today") is currently always a lie.

### 0.4 · Saving has no entry point

`SaveButton`, `SavedProvider` and `saved_jobs` all exist and are all correct.
`grep -rn SaveButton src` returns the definition and nothing else. `JobCard`'s
own comment says saving "lives on the detail page, where the decision to save is
actually made" — and the detail page does not render it. M14 puts it there.

### 0.5 · `searchExamUpdates` exists and is called only by a test

Whole-table update search is written, indexed and contract-tested. No page uses
it, because `/updates` has no search field. M15 wires it — folded into
`listExamUpdates` rather than bolted alongside, so search paginates through the
same cursor path as every other filter (the same fix `listJobs` already got in
`fb13c9b`).

---

## The modules

| | Module | Unblocks | Status |
|---|---|---|---|
| **M13** | Content depth — ingest writes the cold half | M14, M16, M17 | **Built** |
| **M14** | Job detail — everything the notification says, plus Apply and Track | — | **Built** |
| **M15** | Updates — search, the full filter set, and the routing fix | — | **Built** |
| **M16** | Home — the real feed | — | **Built** |
| **M17** | For You — a matcher that can actually match | — | **Built** |
| **M18** | Accounts and user data into the new project | cutover | **Tooling built, not run** |

> **Migrations 0016–0022 are applied to the Supabase project** — verified
> 26 Aug 2026 by probing each object on the remote: `job_details.salary_text`,
> `job_changes`, `level_of`, `popular_exams` and `match_jobs_blocked` all
> resolve. This paragraph previously said they were pending and had to be
> applied first; that is no longer true and blocking on it would waste a deploy
> window. What remains before production is in
> [`PRODUCTION-READINESS.md`](PRODUCTION-READINESS.md).
>
> The underlying warning still holds for the *next* migration: the detail page
> selects `salary_text` and the For You feed calls `match_jobs_blocked`, and
> against a project whose schema is behind the code the job page returns a 500
> rather than degrading. Applying migrations is the first step of a deploy, not
> a bug to design around.

### Two decisions that changed during the build

**`level_of` returns the lowest level named, not the highest.** The plan argued
for the ceiling on precision grounds. Writing the proof for it showed that was
wrong twice over: the column is called `min_qualification_level` and is compared
with `>=`, so the ceiling makes it mean something other than its name — and
"Diploma or B.E./B.Tech", which is how half the engineering notifications in the
country are written, would then be hidden from every diploma holder it is aimed
at. The floor is now the rule, the trade-off is recorded in the migration, and
`03_match_proof.sql` asserts it.

**Blocked jobs come from a second RPC, not a flag on the first.** Changing
`match_jobs`'s return type means dropping and recreating a function the For You
page depends on. `match_jobs_blocked` is a sibling, called in parallel, and the
counters are derived from the two arrays rather than from four count queries —
which was the property the plan actually cared about.

Order is dependency-driven, not preference: M13 must land first or M14 and M17
render empty boxes. §0.1 is a same-day fix and does not wait for M15.

---

## M13 · Content depth

**The point:** every field the scraper already extracts reaches the new database,
and the derived columns the matcher needs are derived rather than remembered.

### Scope

1. **`job_details` writer in the ingest path.** `toJobPayload` splits into a hot
   payload (unchanged) and a cold payload, written to `job_details` in the same
   transaction-shaped batch. Keyed on `job_id`, upserted, and included in
   `content_hash` so an unchanged run still writes zero rows — the M11 gate must
   continue to pass.

2. **Link hygiene at ingest, not at render.** The old page carried
   `isFreeJobAlertUrl` / `isBlockedUrl` filter lists and applied them on every
   view — aggregator links and Telegram invites the source sites inject into
   their own "download" rows. Those lists move to `src/lib/sync/links.ts` and run
   once, at write time. A blocked URL is never stored, so the page ships no
   filter list and can never leak one.

3. **Numeric traps, once.** `salary_min` that is really a pay-matrix level, a
   stipend column summed as a vacancy count — both known, both currently
   re-derived on the client in the old app. They become normalisation rules in
   `src/lib/sync/normalize.ts` with tests, and the render layer stops guessing.

4. **`min_qualification_level` as a generated column.** New migration: a
   `level_of(text)` function in the same shape as `stream_of` — conservative,
   `NULL` when unrecognised — and

   ```sql
   alter table public.jobs
     alter column min_qualification_level ... generated always as (level_of(qualification_summary)) stored;
   ```

   Generated, for the reason 0011 already gives about `required_stream`: a value
   an ingest path has to remember to write is a value that will eventually be
   `NULL` for a month before anyone notices. `jobs_match_idx` is rebuilt.

5. **Backfill from the old project.** `job_metadata` JSONB on the old `jobs`
   table already holds `important_dates`, `application_fees`, `selection_process`,
   `vacancies_detail`, `overview`, `notification_pdf`, `salary_text`,
   `age_limit_text`. One script, `scripts/backfill-job-details.ts`, maps old row
   → `job_details` row, joined on the recomputed `dedupe_key`
   (`sha256(source_url + "\n" + title)`, `ingest.ts:97`) so it lines up with what
   the worker would have written. Idempotent; `--dry-run` first.

6. **`exam_update_details` gets the same treatment**, from the old
   `exam_updates.sections` / `overview` / `download_links` / `related_articles`.

### Decisions

- **The JSONB shape is normalised on write, not on read.** `important_dates`
  arrives from three different scrapers in three shapes; the page must not know
  that. One `ImportantDate[] = { event, date, status?, link? }` written into the
  column, validated by a Zod schema at the ingest boundary. Rows that fail
  validation go to `sync_dead_letter` — they do not go to the page half-parsed.
- **Header-echo rows are dropped at ingest.** The old `vacancyRows` filter
  (`JobDetails.tsx`, the `isHeaderEcho` list) exists because scraped tables
  repeat their own headers as data. That belongs upstream of the renderer.

### Gate

Re-running ingest over unchanged data writes zero rows to `jobs` *and*
`job_details`. Backfill dry-run reports every old row either mapped or listed
with a reason. After backfill, `select count(*) from job_details` is within 2% of
`select count(*) from jobs where status = 'published'`, and no stored URL matches
the blocklist.

---

## M14 · Job detail

**The point:** the old page's completeness — which was genuinely its best
feature — at the new page's cost, which is zero database reads per view.

### What comes across

| Old section | New treatment |
|---|---|
| Four quick-info cards (location, salary, last date, vacancies) | Folded into the existing key-facts `<dl>`. Two renderings of the same four facts was the old page's first duplication. |
| Qualification / experience / age / fee | Already in the `<dl>`. Fee gains the "max of the fee table" fallback the old page computed inline. |
| Description, eligibility | Already there. |
| Salary details, age-limit details (free text) | New sections, server-rendered, shown only when they say more than the `<dl>` already does. |
| Vacancy breakdown table | Server-rendered, header-echo rows already dropped at ingest, columns capped, `overflow-x: auto` on the table's own container — the page body never scrolls sideways. |
| Application fees | A two-column `<dl>`, not a card stack. |
| Selection process | An ordered list. The old one shipped a numbered-circle span per step; a real `<ol>` with `::marker` costs nothing. |
| Important dates | **One merged table.** The old page rendered the job's dates and the exam-updates' dates as two separate tables that overlapped heavily. Merged, de-duplicated on `(event, date)`, with a source label only where they disagree. |
| Overview key-values | A `<dl>`; URL-valued entries render as links (already normalised at ingest). |
| Notification PDF | Promoted out of a card into the action bar's secondary slot — it is a thing you *do*, not a thing you read. |
| Exam updates: summaries, dates, quick links | The existing `UpdatesRail` grows the quick-links list. Already an FK lookup, not the old title-similarity scan. |
| Similar jobs | Stays as `RelatedRail` (same organisation). Vector similarity is deferred; it costs a per-view query and the org rail answers the same question for most listings. |

### The action bar

One sticky bottom bar on mobile, inline on desktop — Apply · Track · Save ·
Share. This is the old page's best interaction and its worst implementation: it
recomputed its own left/width from the sidebar's state on every render.

- **Apply** — the old branching survives verbatim, because it is right: open →
  `apply_link`, else official website; expired → official website as a secondary
  action, or "Application closed"; `last_date_display` reading TBD → treated as
  open. The server renders the link and the neutral label; the client island
  re-labels from `useToday()`, because the page is static and cannot know today.
- **Track** — a server action, `trackExamAction(jobId)`. Finds or creates the
  `exams` row for the job, then upserts one `exam_attempts` row for the user.
  Idempotent on `(user_id, exam_id)`; a second press is a no-op, not a duplicate.
  Signed out → the sign-in route with `?next=` back to this job.
- **Save** — the existing `SaveButton`. Fixes §0.4.
- **Share** — `navigator.share` with a clipboard fallback. ~15 lines, no toast
  library: an `aria-live` region already exists in the shell.

### Budget

The bar is the only new client code on the route: one island, no icon library,
target **≤ 4 kB** over the current route figure, inside `defaultRouteKb` (155).
Everything else on this page is a Server Component and ships nothing.

### Gate

A job page with fully populated `job_details` renders every section and stays
statically prerendered — `next build` lists it under ● (SSG), and hitting it
twice produces zero Supabase queries. Lighthouse a11y 100 on that page, tables
included. Track twice → one `exam_attempts` row. First-load JS within budget.

---

## M15 · Updates (the old "Trending")

**The point:** the old page's findability — search plus five filter axes — with
the searching done in Postgres instead of over 5,336 rows in the browser.

### Scope

1. **§0.1 first.** `FilterChips`, `FilterBar` and `SearchField` take their
   destination from `usePathname()`. One change, three components, unblocks
   everything below.
2. **Search.** `?q=` on `/updates`, folded into `listExamUpdates` exactly as
   `listJobs` does it — same 2-character floor, same cursor invalidation, same
   `websearch` config. `searchExamUpdates` is deleted once its caller exists;
   two search paths over one table is how the `/jobs` one stayed broken.
3. **The full category set.** Eight chips from `UPDATE_CATEGORIES`, not the
   current five, single-select, URL-driven.
4. **Exam filter.** `?exam=` — `listExamUpdates` already accepts `examSlug` and
   nothing passes it. Rendered as a removable chip when active, from the exam's
   own name.
5. **Recency, honestly.** The old "new in 24h" section split results in two and
   made search results appear twice. Replaced by a "New" dot on cards published
   today, derived client-side from `useToday()` — no query, no second list.
6. **Sort.** Newest (default) / oldest, via the existing `SortToggle`, made
   route-agnostic with the rest.

### Dropped, deliberately

- **The refresh button.** Content arrives by tag invalidation. A button that
  cannot fetch anything newer than the CDN already has is a lie about how the
  system works. Replaced by "Updated <relative time>" from the newest row.
- **The location filter.** The old one string-matched state names and
  abbreviations against the exam's name and description — it returned confident
  nonsense. Exam updates carry no state column. It comes back when there is a
  column to filter on, and not before.
- **Framer Motion's hide-on-scroll filter bar.** 34 kB to move a bar 100px. The
  bar is 40px and sticky; on a 375px screen that is affordable, and the
  scroll-jacking was the most complained-about part of the old page.

### Gate

Search over a term that appears only in a row outside the newest 100 returns
that row (the case the old client-side filter could not answer). Filters
compose: category + exam + query + cursor all survive "Load more". Chips
navigate to `/updates`, never `/jobs`. Route stays static-shell + Suspense, first
job of the list above the fold at 375×812.

---

## M16 · Home

**The point:** replace the `SAMPLE` array (`src/app/page.tsx:19`) with the real
feed, keeping the old home page's *shape* — a stack of scannable rows — without
its cost, which was every job in the database in the browser.

### The rows

| Row | Query | Cache |
|---|---|---|
| Closing this week | `listJobs({ sort: "closing", limit: 6 })` | static, `jobs:list` |
| Just published | `listJobs({ sort: "newest", limit: 6 })` | static, `jobs:list` |
| Highest vacancy | new `listHighestVacancy(6)` + partial index | static, `jobs:list` |
| Latest updates | `listExamUpdates({ limit: 5 })` | static, `updates:list` |
| Popular exams | new `listPopularExams(8)` | static, `exams:list` |
| **My exams** | `listAttempts()` | per-user, in Suspense |
| **Matches for you** | `listMatchedJobs(3)` | per-user, in Suspense |

The first five prerender and come from the CDN for everyone. The last two are
the only dynamic reads on the page and they stream in behind their own Suspense
boundaries, so the static half paints immediately for signed-out visitors and
crawlers alike.

### Decisions

- **Popular exams is a stored count, not a per-request aggregate.** The old app
  ranked by `tracking_count`. Counting `exam_attempts` per exam on every home
  render is exactly the pattern this rebuild exists to remove: a
  `exam_popularity` view refreshed by the ingest run, read as one indexed select.
- **Carousels use CSS scroll-snap.** The old rows shipped scroll handlers, ref
  arithmetic and pagination dots for a horizontal list. `snap-x snap-mandatory`
  plus `overflow-x-auto` is the same interaction in zero JavaScript. Desktop
  chevrons are a 12-line island, and only where a row actually overflows.
- **One feed, two audiences.** No `isNewUser` branch computing a different page.
  A signed-out visitor sees the five public rows; signing in adds two. The old
  page's four-way branch on profile completeness is what made it untestable.
- **The hero stays** but its buttons become real links — currently `<Button>`
  elements that navigate nowhere.

### Gate

Signed-out home is fully static (● in the build output) and does one CDN
round-trip. Signed-in home adds exactly two queries, both bounded. LCP element
is the first job row's title. First-load JS within `defaultRouteKb`.

---

## M17 · For You

**The point:** make the matcher able to match (M13 does the schema half), then
give the page back the old one's transparency — which was the reason people
trusted it.

### Scope

1. **Verify the M13 fix end-to-end.** With `min_qualification_level` generated, a
   seeded profile against seeded jobs must return a known row set. This gets a
   test in `queries.contract.test.ts` — the current contract test asserts the
   query is bounded and names its columns, both of which were true while it
   returned nothing for everyone (the same gap that hid the `/jobs` search bug).
2. **The inline profile completer.** The old app's answer was a six-step wizard;
   the current answer is a link to `/profile`. Neither is right. The page renders
   the three fields the hard filters actually need — date of birth, highest
   qualification, discipline — as one small form, posted with a server action,
   in place. Three fields, one round trip, back to a populated feed.
3. **The counters.** Old page: Can Apply / Skills Gap / Review / Not Eligible.
   New page: **Matches** and **Blocked**, returned by the same RPC in the same
   round trip, never four queries. Two buckets, because the old four required a
   soft-eligibility model this schema deliberately does not have.
4. **"Blocked, and why."** A collapsed section under the matches listing jobs
   that failed exactly one hard filter, with that filter named — "Age limit 27,
   you are 29". `match_jobs` grows a `p_include_blocked` flag returning the
   failing predicate. This is the old page's most valuable behaviour: a feed that
   explains its exclusions is a feed you believe when it stays quiet.
   **It does not relax any threshold** — a blocked job is rendered as blocked,
   never as a match. Precision over recall stands.
5. **Reason chips** stay as they are; they already work.

### Explicitly not brought across

The skills dimension (stenography, typing, driving) — the old app's "Skills Gap"
bucket. No column records it and no scraper extracts it; matching on it would be
guessing in the one direction this module is not allowed to guess. It returns
when `required_skills` is populated by ingest, which is a separate piece of work.

### Gate

A seeded profile returns a known, hand-verified row set — and the same profile
with its date of birth removed returns the completer, not an empty feed. Every
blocked job names exactly one blocker. No job appears in both buckets. One RPC
call per page load.

---

## M18 · Accounts and user data into the new project

**The point:** 99 people can sign in to the new app with the password they
already have, and find their saved jobs, tracked exams and education where they
left them.

Under a megabyte, all thirteen tables ([`DATA-EXPORT.md`](DATA-EXPORT.md) Tier 2).
The difficulty is not volume, it is that ids and enums have to line up.

### Order of operations

Content first, always. `saved_jobs` and `exam_attempts` point at jobs and exams,
so those rows must exist in the new project before the user rows can be remapped
onto them. M13's backfill is therefore a prerequisite, not a parallel task.

### Step 1 — the accounts

Preferred path: `pg_dump --data-only --schema=auth -t auth.users -t auth.identities`
from the old project, restored into the new one. This preserves two things that
matter more than anything else in this module:

- **The user's uuid**, so every `user_id` foreign key in Tier 2 lands without a
  mapping table.
- **`encrypted_password`** — bcrypt, and GoTrue on the new project verifies it
  the same way. Nobody resets anything.

Four things that go wrong here and are worth writing down before they do:

1. **`auth.identities` is not optional.** Modern GoTrue resolves an email
   sign-in through `identities`, not `users`. Import `users` alone and every
   account exists and none of them can log in. Rows need `provider = 'email'`,
   `provider_id = id::text`, and `identity_data` carrying `sub` and `email`.
2. **Do not import `auth.sessions` or `auth.refresh_tokens`.** Everyone signs in
   again once; carrying live sessions across projects carries their JWT secret
   assumptions with them.
3. **`email_confirmed_at` must survive**, or 99 people are asked to re-confirm an
   address they confirmed a year ago.
4. **The `handle_new_user` trigger fires on insert** and will create `profiles`
   rows. That is fine and wanted — but the profile import in Step 2 must then be
   an upsert on conflict, not an insert.

If the old project's Postgres is unreachable (the 402 restriction is at the API
gateway; direct connections usually survive — Path A in `DATA-EXPORT.md`), the
fallback is `admin.createUser` per account plus a password-reset email. That is
strictly worse and it is worth an hour of trying Path A to avoid.

### Step 2 — the data, with the mappings that are not one-to-one

| Table | Mapping |
|---|---|
| `profiles` | old `user_id` → new `id`. **All PII is dropped**: aadhaar, PAN, passport, their encrypted twins, caste and EWS certificate numbers, disability certificate, thumb and signature images. The new schema has no columns for them, deliberately — that data was the old project's largest liability and it is not migrating. `preferred_sectors` carries over; `preferred_states`, `district`, `experience_years` start null. |
| `education_qualifications` | `qualification_type` (free text) → `level` enum through an explicit lookup; anything unmapped is **reported, not guessed** — this column feeds a hard filter in `match_jobs`. `qualification_name` → `discipline` (which `stream_of` parses). `passing_year` → `year_of_passing`, `institute_name` → `institution`. |
| `exam_attempts` | `exam_id` remapped old → new by normalised exam name. No match → `exam_id = null` with `custom_name` set, which the schema allows. `year` has no new column: it goes into `notes` as "2025 attempt" rather than being fabricated into `applied_at`. `password_encrypted` and `application_number` are dropped. |
| `saved_jobs` | `job_id` remapped by recomputed `dedupe_key`. Six rows; any that fail to map are listed by title for a manual call. |
| `user_roles` | `app_role` enum → text `role`. The two admins carry over — verify against `/admin` gating before the old project goes away. |
| `documents` | Twelve rows pointing at Storage objects. If the old Storage bucket is reachable, copy objects and rewrite `storage_path`; if not, the rows do not migrate and twelve people re-upload. Not worth engineering around. |
| `saved_exam_updates`, `notification_preferences`, `telegram_connections`, `user_calendar_events` | Straight copies, with the same FK remapping where they point at content. |

### The mechanism

One script, `scripts/migrate-users.ts`, reading the dump (or the CSVs from
`DATA-EXPORT.md` Path B), writing through the service-role client in dependency
order, upserting on primary key so it is safe to re-run. `--dry-run` is the
default and prints per-table counts plus every unmapped foreign key and every
unmapped enum value.

### Gate

Dry-run reports zero unmapped rows, or an explicitly reviewed and accepted list.
A second real run writes zero rows. On a preview deploy, a real migrated account
signs in **with its original password**, and sees its saved jobs, its tracked
exams and its education record. `select count(*) from auth.users` matches the
old project. No aadhaar, PAN or passport value exists anywhere in the new
database — checked, not assumed.

---

## Sequence

```
§0.1 (today)  →  M13  →  M14  →  M15  →  M16  →  M17  →  M18  →  cutover
                  │       │       │       │       │
                  │       └───────┴───────┴───────┘
                  └── unblocks all four surfaces
```

M15 and M16 are independent of each other and of M14 once M13 lands; they are
ordered by user-visible value, not by dependency.

Every module keeps the four rules from the README: no `select("*")`, every query
bounded, static by default, budgets are gates. Nothing here is allowed to raise
a number in `budget.json` without saying so out loud.
