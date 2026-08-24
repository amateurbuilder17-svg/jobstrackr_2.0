-- ═══════════════════════════════════════════════════════════════════════════
-- 0013 · Module 9 · Resolving exam_updates.job_id
-- ═══════════════════════════════════════════════════════════════════════════
-- On the old project this link existed on 3 rows out of 3,373, so every job
-- page fell back to a title-similarity scan costing ~44 kB. 0006 made it a real
-- foreign key with a `job_link_state` recording *why* a row has no link. What
-- was missing is the thing that fills it in.
--
-- Precision over recall, as everywhere else in this app. A wrongly linked
-- update puts the admit card for one exam on a different exam's page, which is
-- worse than no link at all — so anything with more than one plausible target
-- is parked as 'ambiguous' for a human rather than resolved to a guess.

create or replace function public.resolve_update_job_links(p_batch integer default 500)
returns table (linked integer, ambiguous integer, no_match integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_linked    integer := 0;
  v_ambiguous integer := 0;
  v_no_match  integer := 0;
  r           record;
  v_count     integer;
  v_job       uuid;
begin
  -- Only rows nobody has decided about yet, oldest first, and always bounded.
  -- 'ambiguous' rows are deliberately not retried: they were already looked at
  -- and found genuinely undecidable, so re-running this must not quietly
  -- promote one to 'linked' on the same evidence.
  for r in
    select u.id, u.title, u.organization_id
    from public.exam_updates u
    where u.job_link_state = 'unresolved'
    order by u.scraped_at asc
    limit greatest(p_batch, 1)
  loop
    -- Candidate = a published job whose full title appears inside the update's
    -- title. Containment, not similarity: "Result Declared for AIIMS Junior
    -- Engineer (Civil) 2024" contains its job's title exactly, while a
    -- trigram score would happily rate the 2023 edition of the same exam a
    -- near match. An exact substring is a fact; a similarity score is an
    -- opinion.
    --
    -- Scoped to the same organisation when the update names one, because two
    -- bodies routinely run posts with identical titles.
    -- `(array_agg(...))[1]` rather than `min(j.id)`: there is no min() for
    -- uuid. The element is only read when the count is exactly 1, so which
    -- one it picks is immaterial.
    select count(*), (array_agg(j.id))[1]
      into v_count, v_job
    from public.jobs j
    where j.status = 'published'
      and (r.organization_id is null or j.organization_id = r.organization_id)
      and position(lower(j.title) in lower(r.title)) > 0;

    if v_count = 1 then
      update public.exam_updates
         set job_id = v_job, job_link_state = 'linked'
       where id = r.id;
      v_linked := v_linked + 1;

    elsif v_count > 1 then
      update public.exam_updates
         set job_id = null, job_link_state = 'ambiguous'
       where id = r.id;
      v_ambiguous := v_ambiguous + 1;

    else
      update public.exam_updates
         set job_id = null, job_link_state = 'no_match'
       where id = r.id;
      v_no_match := v_no_match + 1;
    end if;
  end loop;

  return query select v_linked, v_ambiguous, v_no_match;
end;
$$;

comment on function public.resolve_update_job_links is
  'Fills in exam_updates.job_id for unresolved rows. Links only when exactly '
  'one published job title appears inside the update title; more than one is '
  'parked as ambiguous for a human rather than guessed. Bounded per call, and '
  'never revisits a row already decided.';

-- Ingest only. This writes a column that decides what appears on a job page,
-- so it is not reachable from a signed-in session.
revoke all on function public.resolve_update_job_links(integer) from public, anon, authenticated;
grant execute on function public.resolve_update_job_links(integer) to service_role;
