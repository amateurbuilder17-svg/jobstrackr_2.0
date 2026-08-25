# Production readiness

**Last updated:** 26 Aug 2026, against the working tree, the live Supabase
project `wqiffxkakigmtzrficrp`, and `jobstrackr.in` as it serves today.

Everything that could be finished from the codebase has been. What is left all
needs an account or a credential that only the owner holds — and four of the
seven items are the *same* credential.

---

## 1. Done

| | Was | Now |
|---|---|---|
| **The rebuild** | M13–M17 uncommitted, 77 files, never pushed | Committed and pushed. `origin/main` carries the four surfaces, the M18 tooling and the docs |
| **CI** | **Red since M12** — every run failed on `ENOTFOUND placeholder.supabase.co`, so three modules were gated by nothing | Green. CI starts a real Supabase, applies every migration, seeds it, and runs `build:local` — the same gate `pnpm verify` runs |
| **Build resilience** | The unreachable-database fallback did not work: `/updates/[slug]` failed the build, the sentinel page failed on its own render, and the sitemap's `allSettled` could not catch a rejection from a `"use cache"` scope | All three fixed and shared through `src/lib/db/build-params.ts` |
| **Old URLs** | `/privacy-policy`, `/terms-of-service`, `/refund-policy`, `/formmate` all 404 | All four resolve. Three real pages, written against what this schema actually stores; `/formmate` 301s to `/jobs` |
| **Error handling** | No `error.tsx` anywhere — a render throw showed a bare "Application error" | Route and root boundaries, the latter with hard-coded colours because it catches the stylesheet failing too |
| **Icons & sharing** | No `public/` at all: default globe in tabs, grey box on every shared link | Favicon, apple icon and a 1200×630 share card, generated from the site's own tokens |
| **Observability** | Nothing reported anything | `onRequestError` reports server errors with the same digest the reader saw. **Zero** client bytes — measured, heaviest route unchanged |
| **Housekeeping** | `prune_operational_data()` existed since migration 0017 and nothing ever called it | Daily Vercel cron, in a `vercel.json` that also pins functions to `bom1` |
| **Accessibility** | Never measured | Every route has exactly one `<h1>`; `/jobs` and `/updates` had none above `lg`, three other routes had two. Job page: 5.63:1 minimum contrast, no unnamed controls, no heading skips, CLS 0 |
| **`exam_updates.job_id`** | 5,256 rows `unresolved` — the resolver had never run | Drained. **0 unresolved** — M9's gate passes |
| **Backups** | None, and the free tier has no point-in-time recovery | `scripts/backup.sh`, verified end to end, `auth.users` included |
| **Deprecation** | `middleware` warned on every build | Renamed to `proxy`; auth redirects verified unchanged |

Two things worth keeping in mind from that work:

- **The bundle budget moved 155 → 158 kB.** Measured, not assumed: removing
  `error.tsx` and rebuilding put the heaviest route back to 154.6 kB. 0.8 kB is
  the error boundary, 1.1 kB the footer. Both are conditions of shipping.
- **`PARITY-PLAN.md`'s migration warning was stale** and is corrected. All 22
  migrations are on the remote; nothing is pending there.

---

## 2. The one credential that unblocks four things

The old project (`fdxksytpdfgmbkttipdf`) is still API-restricted —
`exceed_egress_quota`, every REST and Auth endpoint hard-blocked. **But its
Postgres port is open**, which is Path A in [`DATA-EXPORT.md`](DATA-EXPORT.md)
and exactly what that document predicted:

```
db.fdxksytpdfgmbkttipdf.supabase.co:5432   open
aws-1-ap-south-1.pooler.supabase.com:5432  open
```

So the data is reachable. What is missing is **the old project's database
password**, and it unblocks all of these at once:

| Blocked | Evidence |
|---|---|
| **`exams` is empty** | 0 rows. `popular_exams` returns nothing, so Popular exams, My Exams and the calendar have nothing to show |
| **Job pages are thin** | `description` on 3,930 of 5,788 rows. **`notification_pdf` and `important_dates` are 0%** — the detail page renders both sections and both are empty for every job |
| **99 accounts have not moved** | `scripts/migrate-users.mjs` has never run |
| **Saved jobs and tracked exams** | They point at content, so they follow the accounts |

The cause is now known rather than guessed: `sync_runs` holds **three** rows,
each `rows_seen: 1` — manual tests. The backfill has never run. It reads the old
project and posts through `/api/sync`, and it already passes `job_metadata`
through to the detail writer, so running it populates the missing columns.

```bash
OLD_SUPABASE_URL=... OLD_SUPABASE_SECRET_KEY=... pnpm node scripts/backfill-from-old-project.mjs
```

Run it with `--dry-run` first (the default), content before users, and
`exams` before `exam_attempts`.

---

## 3. The rest, and what each needs

| # | Item | Needs |
|---|---|---|
| 1 | **Vercel project + deploy** | `vercel login` — the CLI is installed but unauthenticated. Then set every key from `.env.example`, deploy to a preview URL, and work from it |
| 2 | **Apps Script → `/api/sync`** | Google account. `apps-script/Config.gs` still targets the old `sync-sheets` edge function; nothing posts to the new worker, so the content is frozen at whatever the backfill leaves. Add the trigger *alongside* the existing files — overwriting a `.gs` has killed scraping before |
| 3 | **Auth email** | Supabase dashboard. The built-in SMTP is rate-limited to a handful an hour and is not for production; sign-up and password reset will fail silently for 99 users. Send yourself a real reset from the preview before cutover |
| 4 | **Sentry DSN** | A Sentry account. The wiring is done and no-ops without it — set `NEXT_PUBLIC_SENTRY_DSN` in Vercel and it starts reporting. No code change |
| 5 | **Google sign-in** | A decision. The provider is off and the app correctly hides the button. Turn it on *before* the migration or leave it off — switching it on afterwards creates a second identity for anyone whose email matches |
| 6 | **The retired features** | A decision. `REBUILD-PLAN.md` §7 says every feature survives; the redirect map retires FormMate, the syllabus finder, documents + OCR and the countdown wall, and the quiz, Telegram alerts, Facebook posting, AI search and the PWA have no route. `telegram_connections`, `notification_preferences` and `documents` still exist as tables and `apps-script/Telegram.gs` is still live |
| 7 | **DNS cutover** | Last. Then verify every old URL against the old sitemap — checked, not spot-checked — with a rollback plan on hand |

**Vercel Hobby is licensed for non-commercial use.** If the site carries ads or
any monetisation, that is a Pro-plan decision to make deliberately rather than
discover.

---

## 4. Two findings that need a judgement, not a fix

### 4.1 · The link resolver cannot match what it is most needed for

Draining it settled every row, and the result is worth reading:

| | |
|---|---|
| linked | 194 |
| ambiguous | 3 |
| no_match | 5,177 |

`no_match` at 96% is not a bug in the resolver — it matches only jobs with
`status = 'published'`, and `close_expired_jobs()` retires a job the moment its
deadline passes. **2,755 of 5,788 jobs are published; 3,033 are closed.**

Results, admit cards and answer keys arrive *after* a recruitment closes. So the
updates most worth attaching to a job page are structurally the ones whose job
is no longer `published` and therefore can never be matched.

The precision-first design is right and should not be loosened. But matching
against closed jobs too is a different question from loosening a threshold, and
it is the difference between a job page that shows its result and one that never
can. Worth deciding on purpose.

**Also:** the 3 `ambiguous` rows are parked for a human by design. Nothing
surfaces them yet.

### 4.2 · Two rendered sections are empty for every job

`notification_pdf` and `important_dates` are at 0% (§2). M14 promoted the
notification PDF into the action bar and merged important dates into one table —
both currently render nothing at all. The backfill should fill them; it is worth
re-checking those two counts specifically after it runs, rather than assuming.

---

## 5. Order

```
vercel login → project → preview deploy
        │
        ├── old DB password → backfill (exams, job_details) → migrate accounts
        │                          │
        │                          └── verify: a real account signs in with its
        │                              original password and sees its saved jobs
        │
        ├── SMTP · Sentry DSN · Google-provider decision
        │
        └── Apps Script → /api/sync, verify a run, retire sync-sheets
                                │
                            DNS  →  verify every old URL  →  rollback plan ready
```

Ingestion moves late on purpose: once Apps Script writes to the new project, the
old site stops updating, and that is the point of no easy return.
