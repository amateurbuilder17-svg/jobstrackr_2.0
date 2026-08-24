-- ═══════════════════════════════════════════════════════════════════════════
-- Module 9 proof: exam_updates.job_id is resolved, never guessed.
-- ═══════════════════════════════════════════════════════════════════════════
-- The gate is "every row has a resolved job_id or an explicit null". The CHECK
-- constraint in 0006 already makes the *shape* impossible to get wrong; what is
-- proved here is the decision — that a unique match links, that two candidates
-- park as ambiguous rather than picking one, and that nothing is left sitting
-- in 'unresolved' after a run.
\set ON_ERROR_STOP on

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL  %  — got %, expected %', label, got, want;
  end if;
  raise notice '  ok   %', label;
end $$;

insert into public.organizations (id, slug, name) values
  ('d0000000-0000-4000-8000-000000000001', 'ssc-m9', 'SSC'),
  ('d0000000-0000-4000-8000-000000000002', 'rrb-m9', 'RRB');

insert into public.jobs (id, slug, title, organization_id, status, last_date, published_at)
values
  -- A title unique within its organisation.
  ('e0000000-0000-4000-8000-000000000001', 'ssc-cgl-m9', 'SSC CGL 2026',
   'd0000000-0000-4000-8000-000000000001', 'published', current_date + 30, now()),

  -- Two posts sharing a title, so nothing can tell them apart.
  ('e0000000-0000-4000-8000-000000000002', 'rrb-group-d-a', 'RRB Group D 2026',
   'd0000000-0000-4000-8000-000000000002', 'published', current_date + 30, now()),
  ('e0000000-0000-4000-8000-000000000003', 'rrb-group-d-b', 'RRB Group D 2026',
   'd0000000-0000-4000-8000-000000000002', 'published', current_date + 45, now()),

  -- Same title as the SSC post but a different body: the organisation scope is
  -- what must stop this being a second candidate.
  ('e0000000-0000-4000-8000-000000000004', 'rrb-cgl-m9', 'SSC CGL 2026',
   'd0000000-0000-4000-8000-000000000002', 'published', current_date + 30, now());

insert into public.exam_updates (slug, title, organization_id, source_url, category)
values
  ('u-unique',    'Admit Card Released for SSC CGL 2026',
   'd0000000-0000-4000-8000-000000000001', 'https://example.gov.in/1', 'admit_card'),
  ('u-ambiguous', 'Result Declared for RRB Group D 2026',
   'd0000000-0000-4000-8000-000000000002', 'https://example.gov.in/2', 'result'),
  ('u-nomatch',   'Notice about an exam nobody here has heard of',
   'd0000000-0000-4000-8000-000000000001', 'https://example.gov.in/3', 'news');

select pg_temp.check('rows start unresolved',
  (select count(*)::int from public.exam_updates where slug like 'u-%' and job_link_state = 'unresolved'), 3);

select public.resolve_update_job_links(500);

-- ── One candidate: linked ──────────────────────────────────────────────────
select pg_temp.check('a unique title match is linked',
  (select job_link_state::text from public.exam_updates where slug = 'u-unique'), 'linked');
select pg_temp.check('...to the right job',
  (select j.slug from public.exam_updates u join public.jobs j on j.id = u.job_id
    where u.slug = 'u-unique'), 'ssc-cgl-m9');
select pg_temp.check('...and the organisation scope kept the same-titled RRB post out',
  (select count(*)::int from public.exam_updates u
    where u.slug = 'u-unique' and u.job_id = 'e0000000-0000-4000-8000-000000000004'), 0);

-- ── Two candidates: parked, not guessed ────────────────────────────────────
select pg_temp.check('two candidates park as ambiguous',
  (select job_link_state::text from public.exam_updates where slug = 'u-ambiguous'), 'ambiguous');
select pg_temp.check('...with no job_id invented',
  (select job_id from public.exam_updates where slug = 'u-ambiguous'), null::uuid);

-- ── No candidate ───────────────────────────────────────────────────────────
select pg_temp.check('nothing to match is no_match',
  (select job_link_state::text from public.exam_updates where slug = 'u-nomatch'), 'no_match');

-- ── The gate itself ────────────────────────────────────────────────────────
select pg_temp.check('nothing is left unresolved after a run',
  (select count(*)::int from public.exam_updates where job_link_state = 'unresolved'), 0);
select pg_temp.check('every row has a job_id or an explicit reason',
  (select count(*)::int from public.exam_updates
    where (job_link_state = 'linked') <> (job_id is not null)), 0);

-- ── Re-running must not promote a parked row on the same evidence ──────────
select public.resolve_update_job_links(500);
select pg_temp.check('a second run leaves ambiguous alone',
  (select job_link_state::text from public.exam_updates where slug = 'u-ambiguous'), 'ambiguous');
