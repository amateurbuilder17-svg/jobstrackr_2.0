-- ═══════════════════════════════════════════════════════════════════════════
-- 0028 · merge_duplicate_jobs: cover organization_id IS NULL
-- ═══════════════════════════════════════════════════════════════════════════
-- 0027 partitioned duplicate groups by `(organization_id, lower(btrim(title)))`,
-- which is right when the organisation is known — two different bodies can
-- legitimately share a generic title. But it silently skipped every job whose
-- organisation never resolved, `partition by null` does not group rows
-- together at all. Running 0027 against production found 20 exact-title
-- duplicate pairs sitting in that gap, e.g. two identical rows for "NALCO
-- Non-Executive Recruitment 2026 ... 268 Technician, Operator and More Posts".
--
-- These titles are long, specific, machine-generated strings (post counts,
-- deadlines, department names folded in) — an accidental collision between two
-- unrelated postings is not a realistic risk the way it would be for a bare
-- title like "Clerk Recruitment 2026". So the organisation-less half of the
-- table is grouped on title alone.
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
  ),
  ranked_no_org as (
    select
      id,
      first_value(id) over (
        partition by lower(btrim(title))
        order by
          (last_date is not null) desc,
          (source_url is not null and source_url !~* '^[a-z]+://[^/]+/?$') desc,
          (source_url !~* 'freejobalert\.com') desc,
          created_at desc,
          id
      ) as canonical_id,
      count(*) over (partition by lower(btrim(title))) as grp_size
    from public.jobs
    where organization_id is null
  )
  select id as loser_id, canonical_id from ranked where grp_size > 1 and id <> canonical_id
  union all
  select id as loser_id, canonical_id from ranked_no_org where grp_size > 1 and id <> canonical_id;

  select count(*) into v_merged from _job_merge_map;
  if v_merged = 0 then
    return 0;
  end if;

  update public.exam_updates eu
  set job_id = m.canonical_id
  from _job_merge_map m
  where eu.job_id = m.loser_id;

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
  delete from public.exam_attempts ea
  using _job_merge_map m
  where ea.job_id = m.loser_id;

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

  delete from public.jobs j
  using _job_merge_map m
  where j.id = m.loser_id;

  return v_merged;
end;
$$;

comment on function public.merge_duplicate_jobs is
  'Collapses jobs that are the same posting scraped from two sources into one row, '
  'reassigning every referencing table first. Groups by (organization_id, title) when '
  'the organisation is known, by title alone when it is not. Idempotent; called daily '
  'from /api/cron/prune.';
