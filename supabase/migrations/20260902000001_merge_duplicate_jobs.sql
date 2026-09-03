-- ═══════════════════════════════════════════════════════════════════════════
-- 0027 · Merging cross-source job duplicates
-- ═══════════════════════════════════════════════════════════════════════════
-- `dedupe_key` is `sha256(source_url + title)`, so the same recruitment
-- notification scraped from two different pages — the organisation's own site
-- and a republish on an aggregator — earns two different keys and two rows.
-- ~3,900 jobs existed twice this way as of 2026-09-02, all from the same
-- organisation under the same title text.
--
-- This is not the ingest bug the exam_updates NULL-dedupe_key cleanup fixed —
-- it is two legitimate sources describing the same posting. `ingestJobs`
-- keeps its per-source identity (correct: an edited listing on one source
-- must not be confused with an unrelated one on another), so nothing there
-- changes. This function runs after ingestion and collapses what ingestion
-- correctly kept apart.
--
-- One survivor per (organization_id, normalised title) group, ranked by:
--   1. has a closing date — a listing with no `last_date` is usually a scrape
--      of a generic page (an org's homepage, reused across every one of its
--      postings) rather than the notification itself.
--   2. `source_url` has a path, not just a bare domain — the same signal as
--      (1) from the URL shape instead of the data: `https://www.manit.ac.in/`
--      cannot be posting-specific, `.../articles/manit-bhopal-...` can.
--   3. not on a known aggregator domain — once (1) and (2) tie, prefer the
--      organisation's own site over a republish.
--   4. most recently created — final tiebreak.
--
-- Idempotent and safe to run daily: a group with one row does nothing, and a
-- group already merged down to one row has nothing left to find.
create or replace function public.merge_duplicate_jobs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_merged integer;
begin
  create temporary table _job_merge_map on commit drop as
  with ranked as (
    select
      id,
      first_value(id) over (
        partition by organization_id, lower(btrim(title))
        order by
          (last_date is not null) desc,
          (source_url is not null and source_url !~* '^[a-z]+://[^/]+/?$') desc,
          (source_url !~* 'freejobalert\.com') desc,
          created_at desc,
          id
      ) as canonical_id,
      count(*) over (partition by organization_id, lower(btrim(title))) as grp_size
    from public.jobs
    where organization_id is not null
  )
  select id as loser_id, canonical_id
  from ranked
  where grp_size > 1 and id <> canonical_id;

  select count(*) into v_merged from _job_merge_map;
  if v_merged = 0 then
    return 0;
  end if;

  -- Every table with a foreign key into `jobs` gets the loser's rows moved to
  -- the canonical row before the loser is deleted, in FK-dependency order.
  -- Skipping this would mean ON DELETE CASCADE silently unsaving a user's
  -- tracked job, deleting their calendar reminder, or losing their tracker
  -- entry — the merge is supposed to be invisible to them.

  update public.exam_updates eu
  set job_id = m.canonical_id
  from _job_merge_map m
  where eu.job_id = m.loser_id;

  -- `saved_jobs` and `exam_attempts` key on (user_id, job_id): if a user
  -- already has the canonical row saved/tracked, reassigning the loser's row
  -- on top would violate that. Guarded, so it only moves the rows that
  -- wouldn't collide — the rest are true duplicates for that one user and are
  -- cleaned up (not silently orphaned) below.
  update public.saved_jobs sj
  set job_id = m.canonical_id
  from _job_merge_map m
  where sj.job_id = m.loser_id
    and not exists (
      select 1 from public.saved_jobs sj2
      where sj2.user_id = sj.user_id and sj2.job_id = m.canonical_id
    );

  update public.user_calendar_events uce
  set job_id = m.canonical_id
  from _job_merge_map m
  where uce.job_id = m.loser_id;

  update public.exam_attempts ea
  set job_id = m.canonical_id
  from _job_merge_map m
  where ea.job_id = m.loser_id
    and not exists (
      select 1 from public.exam_attempts ea2
      where ea2.user_id = ea.user_id and ea2.job_id = m.canonical_id
    );
  -- A leftover attempt here means the user already tracks the canonical job;
  -- deleted outright rather than left for ON DELETE SET NULL, which would hit
  -- `exam_attempts_has_subject` on any row with no `exam_id`/`custom_name`.
  delete from public.exam_attempts ea
  using _job_merge_map m
  where ea.job_id = m.loser_id;

  -- `subject_key` is derived from `job_id` (`'job:' || job_id`) and is the
  -- primary key, so it moves in lockstep with the reassignment.
  update public.exam_status_reports esr
  set job_id = m.canonical_id, subject_key = 'job:' || m.canonical_id
  from _job_merge_map m
  where esr.job_id = m.loser_id
    and not exists (
      select 1 from public.exam_status_reports esr2
      where esr2.subject_key = 'job:' || m.canonical_id
    );

  update public.job_changes jc
  set job_id = m.canonical_id
  from _job_merge_map m
  where jc.job_id = m.loser_id;

  -- `job_details` needs no handling: it is keyed 1:1 on `job_id` and cascades
  -- with the loser row, and the canonical row keeps its own.
  delete from public.jobs j
  using _job_merge_map m
  where j.id = m.loser_id;

  return v_merged;
end;
$$;

comment on function public.merge_duplicate_jobs is
  'Collapses jobs that are the same posting scraped from two sources into one row, '
  'reassigning every referencing table first. Idempotent; called daily from /api/cron/prune.';
