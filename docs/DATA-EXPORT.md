# Getting the data out of the restricted project

The old project returns HTTP 402 on REST, Auth and Storage. The **SQL Editor** in the
dashboard goes through a different path and should still work — the Table Editor may
not, because it talks to the same blocked PostgREST API.

So: **use the SQL Editor**, not the Table Editor. Run each query, then use the
**Download CSV** button above the results grid.

> One rule throughout: this database times out (`57014`) on large unbounded scans, so
> every query below is chunked. Do not remove the `LIMIT`s.

---

## Step 1 — Size everything first

Run this one query and paste me the result. It is cheap, and it tells me exactly how
to chunk the rest. **Nothing else should be run until this comes back.**

```sql
select
  c.relname                                   as table_name,
  c.reltuples::bigint                         as approx_rows,
  pg_size_pretty(pg_total_relation_size(c.oid)) as total_size,
  pg_total_relation_size(c.oid)               as bytes
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by bytes desc;
```

Then this, for the auth schema:

```sql
select count(*) as auth_users from auth.users;
```

---

## Step 2 — Export order

Once I see the sizes I will give you exact chunked queries. The order matters,
because the new project's foreign keys are created in this sequence:

**Tier 1 — content (rebuildable from the Sheet if anything fails)**
`jobs` · `exams` · `exam_updates` · `scraper_sources` · `logos`

**Tier 2 — user data (irreplaceable — this is the tier that actually matters)**
`auth.users` · `profiles` · `education_qualifications` · `saved_jobs` ·
`saved_exam_updates` · `exam_attempts` · `documents` · `user_calendar_events` ·
`notification_preferences` · `telegram_connections` · `user_roles`

**Tier 3 — operational logs (deliberately not migrating)**
`api_usage_logs` · `update_logs` · `ai_job_discover_logs` · `ai_exam_discover_logs` ·
`scraper_run_logs` · `telegram_sent_jobs` · `facebook_sent_jobs` · `sheet_sync_runs` ·
`scrape_queue`

These start fresh in the new project. They are the tables that grew unbounded and
contributed to the storage problem.

---

## Step 3 — Auth users

Sign-ins only survive the move if the password hashes come with them. That means
exporting `auth.users` with `encrypted_password` intact:

```sql
select id, email, encrypted_password, email_confirmed_at,
       raw_user_meta_data, raw_app_meta_data, created_at, updated_at,
       last_sign_in_at, phone, confirmation_sent_at
from auth.users
order by created_at
limit 1000;
```

Handle that CSV like a password file — it effectively is one. Keep it off email and
chat, and delete it once the import is verified.

If migrating hashes turns out to be more trouble than it is worth, the fallback is a
one-time "set a new password" flow on first sign-in, keyed on the preserved email.
That is a product decision, not a technical blocker — tell me which you prefer.

---

## Step 4 — Storage buckets

If `documents` rows point at files in Supabase Storage, the rows are useless without
the files, and Storage is also 402-blocked. Check whether the bucket is reachable
from the dashboard's Storage tab. If it is not, uploaded documents are likely lost
and the feature restarts empty — worth knowing now rather than at cutover.

---

## What I need back from you

1. The output of the two Step 1 queries.
2. Whether the Storage tab loads.
3. Whether you have the old project's **database password** — if you do, a direct
   `pg_dump` over the pooler may bypass all of this and take one command instead of
   twenty.
