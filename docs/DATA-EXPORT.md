# Getting the data out of the restricted project

Sizing came back. The picture is much better than it looked.

---

## What is actually there

**87.6 MB across 37 tables**, and it splits cleanly into three tiers.

### Tier 1 — Content · 72.8 MB · must migrate

| Table | Rows | Size | Per row |
|---|---:|---:|---:|
| `exam_updates` | 5,336 | 39.5 MB | 7.6 kB |
| `jobs` | 5,861 | 34.1 MB | 6.0 kB |
| `exams` | 107 | 400 kB | 3.8 kB |
| `syllabus_cache` | 19 | 304 kB | 16 kB |
| `cutoff_cache` | ? | 120 kB | — |
| `scraper_sources` | ? | 64 kB | — |

`jobs` + `exam_updates` alone are **82% of the database**. Everything hard about
this export is those two tables; everything else is trivial.

Those per-row figures are the story in miniature: 6–7 kB per row is enormous for
what is mostly short text fields. It is the JSONB columns — `job_metadata`
(with `eligibility_profile` inside it) and `exam_updates.sections` /
`overview` / `related_articles`. The old app shipped those columns to every
visitor. Module 1 splits them into a separate cold table so a job *card* costs
~400 bytes instead of 6 kB.

### Tier 2 — User data · 0.8 MB · irreplaceable

| Table | Rows |
|---|---:|
| `auth.users` | 99 |
| `exam_attempts` | 66 |
| `profiles` | 33 |
| `documents` | 12 |
| `saved_jobs` | 6 |
| `user_roles` | 2 |
| `education_qualifications` | 1 |
| 6 more | unknown — see Step 1 |

**Under a megabyte, all thirteen tables together.** No chunking, no pagination —
one query each and you are done. This tier was the thing I was most worried
about, and it turns out to be the easy part.

Worth noticing: 99 accounts but only 33 profiles, 6 saved jobs, and 1 education
record. Two thirds of registered users never finished onboarding. That is a
product signal for Module 6, not a migration problem.

### Tier 3 — Ops & logs · 14.1 MB · deliberately abandoned

`api_usage_logs` (19,512 rows), `telegram_sent_jobs`, `sheet_sync_runs`,
`auto_discover_logs`, `scraper_run_logs`, and thirteen more.

These start empty in the new project — **14.1 MB reclaimed for free**, and they
are exactly the unbounded-growth tables that helped fill the old one. The new
schema gives every log table a retention policy from day one.

---

## Path A — one command (strongly preferred)

The 402 restriction is applied at Supabase's **API gateway**. Direct Postgres
connections usually keep working, which would make this whole document
unnecessary.

It needs the database password. If it was never saved, **reset it** — that is a
platform-level operation and should work even while the project is restricted:

> Dashboard → old project → Settings → Database → **Reset database password**

Then, with the new password:

```bash
pg_dump "postgresql://postgres.fdxksytpdfgmbkttipdf:PASSWORD@aws-0-ap-south-1.pooler.supabase.com:5432/postgres" --no-owner --no-privileges --schema=public --schema=auth -f old-project.sql
```

Check first that your `pg_dump` is not older than the server, or it will refuse:

```bash
pg_dump --version
```

If that fails or your local version is too old, Docker sidesteps it entirely:

```bash
docker run --rm -v "$PWD:/out" postgres:17 pg_dump "postgresql://postgres.fdxksytpdfgmbkttipdf:PASSWORD@aws-0-ap-south-1.pooler.supabase.com:5432/postgres" --no-owner --no-privileges --schema=public --schema=auth -f /out/old-project.sql
```

**Try this before anything else.** One command, complete fidelity, password
hashes included, and it takes about a minute. Tell me the error if it fails —
the failure mode tells us whether the pooler is blocked or just the credentials
are wrong.

---

## Path B — SQL Editor, if Path A is genuinely blocked

### Step 1 — exact counts for the unknown tables

Six tables reported `-1`, which means *never analysed*, not *empty*. One cheap
query settles it:

```sql
select 'cutoff_cache' as t, count(*) from cutoff_cache
union all select 'scraper_sources', count(*) from scraper_sources
union all select 'telegram_connections', count(*) from telegram_connections
union all select 'notification_preferences', count(*) from notification_preferences
union all select 'user_calendar_events', count(*) from user_calendar_events
union all select 'saved_exam_updates', count(*) from saved_exam_updates
union all select 'suggestions_grievances', count(*) from suggestions_grievances
union all select 'payment_history', count(*) from payment_history
union all select 'user_subscriptions', count(*) from user_subscriptions
union all select 'subscription_plans', count(*) from subscription_plans
order by 1;
```

### Step 2 — user tier, one query per table

All tiny. Run each, click **Download CSV**.

```sql
select * from profiles;
select * from education_qualifications;
select * from exam_attempts;
select * from saved_jobs;
select * from saved_exam_updates;
select * from documents;
select * from user_calendar_events;
select * from notification_preferences;
select * from telegram_connections;
select * from user_roles;
select * from suggestions_grievances;
```

And auth — handle this CSV like the password file it effectively is. Keep it off
email and chat, and delete it once the import is verified.

```sql
select id, email, encrypted_password, email_confirmed_at,
       raw_user_meta_data, raw_app_meta_data, created_at, updated_at,
       last_sign_in_at, phone, confirmation_sent_at
from auth.users order by created_at;
```

### Step 3 — the two big tables, chunked

This database times out (`57014`) on large unbounded scans, so these go in
slices. Keyset pagination on `id`, not `OFFSET` — offset gets slower every page
and is exactly what times out.

**`jobs` — 12 chunks of 500.** Run, download, then paste the last `id` of the
result into the next run. Start with the empty-string sentinel:

```sql
select * from jobs
where id::text > ''          -- ← replace with the previous chunk's last id
order by id::text
limit 500;
```

**`exam_updates` — 18 chunks of 300.** Rows are larger here, hence smaller slices:

```sql
select * from exam_updates
where id::text > ''          -- ← replace with the previous chunk's last id
order by id::text
limit 300;
```

**Small content tables — one query each:**

```sql
select * from exams;
select * from scraper_sources;
select * from cutoff_cache;
```

`syllabus_cache` is a cache. It regenerates. Skip it.

---

## Step 4 — Storage

`documents` has 12 rows, and those rows are pointers — the files live in
Supabase Storage, which is also 402-blocked. Check whether the Storage tab
loads. With only 12 files, if it does not, the honest answer is that the feature
restarts empty and twelve people re-upload. Not worth engineering around.

---

## What I need from you

1. **Try Path A.** It replaces everything below it. Report the exact error if it fails.
2. If Path A fails, the Step 1 count query.
3. Whether the Storage tab loads.
