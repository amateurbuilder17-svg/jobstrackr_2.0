# Production readiness — what is actually left

**Checked:** 26 Aug 2026, against the working tree, the live Supabase project
`wqiffxkakigmtzrficrp`, and `jobstrackr.in` as it serves today.

The build quality is not the problem. `pnpm verify` is green end to end, all 22
migrations are on the remote, and 5,788 jobs are already imported. What is
missing is everything between "it runs on my machine" and "it is the site."

---

## 0. What I verified, so it is not re-litigated

| Check | Result |
|---|---|
| `pnpm verify` | **Green** — typecheck, lint, format, 14 test files, build, both budgets |
| Build output | 433 pages, 240 job pages + 180 update pages prerendered from live data |
| Bundle budget | Heaviest route `/profile` at 153.5 kB against a 155 kB ceiling |
| Traffic budget | 0.08 GB projected Supabase egress — 1.5% of the free tier |
| Remote migrations | **All 22 applied.** `match_jobs_blocked`, `popular_exams`, `level_of`, `job_details.salary_text` all present |
| Content | 5,788 jobs · 5,788 `job_details` · 3,321 organizations · 5,374 exam updates |
| `min_qualification_level` | Populated on 5,059 of 5,788 rows (87%) — the generated column works |
| Job detail page | Renders key facts, description, and the Apply / Track / Save / Share bar |

> **`PARITY-PLAN.md` is stale on one point.** It warns that migrations 0019–0022
> must be applied before anything ships. They already are — I probed each object
> on the remote directly. That warning should come out so nobody blocks on it.

---

## 1. Blockers — nothing can ship until these are done

### 1.1 · None of the work is committed

`git status` shows **77 changed files**; `origin/main` is still at `fb13c9b`
("M12 partial"). Modules M13 through M17 — content depth, the job detail page,
updates search, the home feed, the For You matcher — exist only in this working
tree. CI has never run against them, and there is no commit to deploy.

**Do:** review the diff, split it along module lines, commit, push. CI must go
green on GitHub, not just locally.

### 1.2 · There is no deployment

No `.vercel` directory, no `vercel.json`. `jobstrackr.in` still serves the old
Vite app — its HTML links `/assets/main-drsmG-3n.js`. The rebuild has never been
deployed anywhere, not even to a preview URL.

**Do:** create the Vercel project (region `bom1`), set every key from
`.env.example` in the project's environment, deploy to a preview URL, and work
from that URL for the rest of this list. DNS moves last.

**Flag:** Vercel Hobby is licensed for non-commercial use. If the site carries
ads or any monetisation, this is a Pro-plan decision, not an oversight to
discover after cutover.

### 1.3 · Ingestion still feeds the old project

`apps-script/Config.gs` targets the old Supabase Edge Function `sync-sheets`.
Nothing anywhere posts to the new `/api/sync`. The 5,788 jobs in the new
database are a one-off backfill, and they have been going stale since the moment
they landed.

**Do:** point an Apps Script time-trigger at `POST /api/sync` with
`SHEETS_SYNC_SECRET`, verify a run writes rows, then retire `sync-sheets`.

**Care:** the Apps Script project is a single shared project — overwriting a
`.gs` file has previously killed scraping outright. Add the new trigger
alongside the existing files; do not replace them.

### 1.4 · The `exams` table is empty

Zero rows. `popular_exams` returns `[]`, so the home page's Popular exams row
renders nothing, My Exams and the calendar have nothing to show, and M18's
`exam_attempts` remap has nothing to map onto.

**Do:** backfill `exams` from the old project before the user migration runs.
This is a prerequisite for 1.5, not a parallel task.

### 1.5 · No accounts have migrated (M18)

`scripts/migrate-users.mjs` is written and has never been run. 99 accounts,
their saved jobs, tracked exams and education records are all still only in the
old project.

**Do:** dry-run first and read the unmapped-row report. Then the real run.
**Gate:** on the preview deploy, a real migrated account signs in *with its
original password* and sees its saved jobs — and no aadhaar, PAN or passport
value exists anywhere in the new database, checked rather than assumed.

---

## 2. Production hygiene — cheap, and each one is visible to users

### 2.1 · No error boundaries

Zero `error.tsx` or `global-error.tsx` in the entire app. Any render throw shows
Next's default error page. Given the detail page is documented to 500 rather
than degrade when the schema drifts, this is the difference between a bad
minute and a bad screenshot.

### 2.2 · No Sentry

Not installed; `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and
`SENTRY_PROJECT` are all blank in `.env.local`. M12's gate names it, and the
plan calls it "the one optional I would not skip." Right now production errors
would be invisible.

### 2.3 · There is no `public/` directory at all

No favicon, no app icon, no apple-touch-icon, and no `opengraph-image` route —
which M5's gate promised. Every job link shared to WhatsApp renders a blank
card, and every browser tab shows the default globe. For a site whose growth
comes from shared notification links, this is not cosmetic.

### 2.4 · Four old URLs 404

M12's gate is "every old URL resolves 200 or 301." These four exist in the old
app, have no page in the new one, and no redirect in `next.config.ts`:

| Old route | Old file | Status now |
|---|---|---|
| `/privacy-policy` | `src/pages/PrivacyPolicy.tsx` | **404** |
| `/terms-of-service` | `src/pages/TermsOfService.tsx` | **404** |
| `/refund-policy` | `src/pages/RefundPolicy.tsx` | **404** |
| `/formmate` | `src/pages/FormMate.tsx` | **404** |

The first three are not optional furniture — an app that holds accounts and
personal data needs a reachable privacy policy, and any ad network requires one.
Port the three legal pages as static routes. `/formmate` needs the §4 decision.

### 2.5 · Auth email has no real sender

Supabase's built-in SMTP is rate-limited to a handful of messages per hour and
is explicitly not for production. Sign-up confirmation and password reset for 99
users will silently fail against it.

**Do:** configure custom SMTP on the new project, and send yourself a real
password reset from the preview deploy before cutover.

### 2.6 · `prune_operational_data` is never called

`close_expired_jobs` runs on every ingest (`src/app/api/sync/route.ts:180`) —
good. `prune_operational_data` has no caller anywhere in `src`. `sync_runs`,
`sync_dead_letter` and `job_changes` will grow without bound against a 500 MB
database.

**Do:** one Vercel cron, daily. That is what the plan reserved the two Hobby
crons for.

### 2.7 · The accessibility gates were never measured

`scripts/a11y-audit.js` is a console paste-in, and M3's gate (axe zero
violations, CLS < 0.02) and M14's (Lighthouse a11y 100 on a job page) have not
been run against real pages. Run both against the preview deploy.

---

## 3. Data quality — not ship-blocking, but users will see it

### 3.1 · `exam_updates.job_id` is 2.2% populated

118 of 5,374 rows are linked. Better than the old app's 3 of 3,373, but M9's
gate was "every update row has a resolved `job_id` or an explicit null."

**Do:** confirm this is genuine — most updates may truly have no matching job —
rather than the resolver not running at ingest. If it is genuine, say so in the
migration and close the gate. If it is not, fix the resolver.

### 3.2 · A third of detail pages are thin

3,930 of 5,788 `job_details` rows have a description. The row-count gate passes
(every job has a row), but 1,858 job pages will render mostly empty sections —
the exact complaint M13 existed to fix.

**Do:** check whether the backfill's `dedupe_key` join missed those rows, or
whether the old data genuinely lacked the content.

---

## 4. Decisions still open

**The quietly retired features.** `REBUILD-PLAN.md` §7 Q2 answered "every feature
survives." The redirect map does something else: FormMate, the syllabus finder,
documents + OCR, and the countdown wall all now 301 into other pages. The quiz,
Telegram alerts, Facebook auto-posting, AI job search and the PWA have no route
at all — though `telegram_connections`, `notification_preferences` and
`documents` all exist as tables, and `apps-script/Telegram.gs` is still live.

This needs one explicit call: kept, or dropped. Right now it is neither, and
`/formmate` 404s as a side effect.

**Google sign-in.** `SUPABASE_AUTH_EXTERNAL_GOOGLE_*` is in `.env.example` but
not in `.env.local`, and the provider is off — the app correctly hides the
button. Turn it on before migration or leave it off permanently; switching it on
afterwards creates a second identity for anyone whose email matches.

**Backups.** Free-tier Supabase has no point-in-time recovery. A scheduled
`pg_dump` somewhere is the whole mitigation, and it does not exist yet.

---

## 5. The order to do it in

```
commit + push + green CI          ─┐
Vercel project + preview deploy    │  nothing else can be tested without these
                                  ─┘
backfill exams  →  migrate accounts (dry-run → real → sign-in gate)
legal pages · icons + OG · error boundaries · Sentry · SMTP · prune cron
a11y + Lighthouse against the preview URL
point Apps Script at /api/sync, verify a run, retire sync-sheets
────────────────────────────────────────────────────────────────────
DNS  →  verify every old URL resolves 200 or 301  →  rollback plan on hand
```

Ingestion moves late deliberately: once Apps Script writes to the new project,
the old site's data stops updating, and that is the point of no easy return.

**Cutover gate:** a real migrated account signs in with its original password on
the production domain, sees its saved jobs, and every URL in the old sitemap
resolves 200 or 301 — checked against the old sitemap, not spot-checked.
