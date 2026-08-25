-- ═══════════════════════════════════════════════════════════════════════════
-- 0016 · Closing-date ordering, and retiring expired listings
-- ═══════════════════════════════════════════════════════════════════════════
-- "Newest first" is a publisher's ordering. The person reading this list has a
-- deadline, and newest-first actively buries a job closing tomorrow beneath one
-- posted this morning that closes in sixty days. The default becomes closing
-- soonest.
--
-- That only works if `status = 'published'` actually means "you can still
-- apply". It does not today: nothing ever moves a row off `published` when its
-- window shuts, so an ascending sort on `last_date` would lead with every job
-- that closed last year.
--
-- The enum has carried `closed` since 0002 and `sync_runs.kind` has allowed
-- `'reconcile'` since 0009. This migration supplies the missing half.

-- ── Ordering ───────────────────────────────────────────────────────────────
-- Mirrors `jobs_feed_idx`. The `id` tie-break is not decorative: dozens of jobs
-- share a closing date, and without a second key a keyset page boundary can
-- repeat or drop rows — the classic pagination bug the feed index already
-- guards against.
create index jobs_closing_idx
  on public.jobs (last_date, id)
  where status = 'published';

-- The partial index on `(last_date)` from 0004 is now redundant: this one
-- serves the same predicate and carries the tie-break as well.
drop index if exists public.jobs_last_date_idx;

-- ── Retiring expired listings ──────────────────────────────────────────────
-- Called at the top of every ingest run rather than from a Vercel cron. Hobby
-- allows two crons at daily granularity, and both are spoken for; the Apps
-- Script trigger already fires hourly, so this rides along for free and a job
-- leaves the feed within an hour of its window shutting rather than within a
-- day.
--
-- `closed` rather than `archived`: the listing was real and ran its course, and
-- its page stays reachable. `archived` means withdrawn or superseded, which is
-- a different claim to make about a recruitment notice.
--
-- Rows with no `last_date` are never touched. A published row is required by
-- `jobs_published_has_essentials` to have one, so this is defensive rather than
-- expected — but "no stated deadline" must never be read as "expired".
create or replace function public.close_expired_jobs()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected integer;
begin
  update public.jobs
     set status = 'closed'
   where status = 'published'
     and last_date is not null
     -- Strictly less than today in IST, not `now()`: a closing date of the 10th
     -- means end of the 10th for someone in India, and a server on UTC would
     -- retire the listing five and a half hours before it actually shut.
     and last_date < (timezone('Asia/Kolkata', now()))::date;

  get diagnostics affected = row_count;
  return affected;
end;
$$;

comment on function public.close_expired_jobs() is
  'Moves published jobs past their closing date to status = closed. Idempotent: '
  'a second call in the same day affects zero rows. Called by the ingest worker.';

revoke all on function public.close_expired_jobs() from public, anon, authenticated;
grant execute on function public.close_expired_jobs() to service_role;

-- ── Reading a closed listing ───────────────────────────────────────────────
-- The detail page must still resolve for a closed job. ~5,200 of these slugs
-- are indexed, and a 404 on every expired notice would throw away the crawl
-- surface this rebuild exists to protect. RLS on `jobs` selects on status, so
-- the policy has to widen with the reads.
drop policy if exists jobs_public_read on public.jobs;

create policy jobs_public_read
  on public.jobs
  for select
  to anon, authenticated
  using (status in ('published', 'closed'));

comment on policy jobs_public_read on public.jobs is
  'Published and closed listings are public. Closed ones stay readable so their '
  'indexed pages keep resolving; every list query filters to published itself.';

-- The detail rows have to widen with their parent, or a closed job resolves to
-- a page with a title and no content — which is worse than a 404, because it
-- looks like the listing lost its data rather than its deadline.
drop policy if exists job_details_public_read on public.job_details;

create policy job_details_public_read on public.job_details
  for select to anon, authenticated using (
    exists (
      select 1 from public.jobs j
       where j.id = job_id and j.status in ('published', 'closed')
    )
  );
