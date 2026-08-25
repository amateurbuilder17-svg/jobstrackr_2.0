-- ═══════════════════════════════════════════════════════════════════════════
-- 0022 · Module 17 · Why a job did not match
-- ═══════════════════════════════════════════════════════════════════════════
-- `match_jobs` is a wall of hard filters, and that is right: a feed that says
-- "you are eligible" and is wrong costs someone a ₹500 fee and a fortnight of
-- waiting. But a filter that only ever removes things is impossible to trust.
-- The old app's For You page was believed because it showed its working —
-- "Can Apply", "Skills Gap", "Review", "Not Eligible", each with the reason
-- printed on the card. This page currently shows matches and silence.
--
-- So: the same predicates, evaluated individually rather than as one AND, and
-- the jobs that fail *exactly one* of them come back with that one named.
--
-- What this deliberately is not: a relaxation. Nothing here widens
-- `match_jobs` by a single row. A blocked job is rendered as blocked, in its
-- own section, under its own heading. The two sets never overlap — a job
-- failing one test cannot be in the set that fails none.

create or replace function public.match_jobs_blocked(p_limit integer default 20)
returns table (
  id                  uuid,
  slug                text,
  title               text,
  location            text,
  state               text,
  last_date           date,
  last_date_display   text,
  vacancies           integer,
  vacancies_display   text,
  salary_min          integer,
  salary_max          integer,
  salary_display      text,
  application_fee     integer,
  tags                text[],
  is_featured         boolean,
  published_at        timestamptz,
  organization        jsonb,
  -- Which single test failed, and the value that failed it. The sentence is
  -- composed in the UI, which already holds the human labels for every
  -- qualification level and does not need them duplicated in SQL.
  blocker             text,
  blocker_value       text
)
language sql
stable
set search_path = ''
as $$
with me as (
  select
    p.id,
    p.gender,
    p.experience_years,
    p.highest_qualification,
    case
      when p.date_of_birth is null then null
      else extract(year from age(current_date, p.date_of_birth))::int
    end as age
  from public.profiles p
  where p.id = (select auth.uid())
),
my_streams as (
  select public.stream_of(e.discipline) as stream, e.level
  from public.education_qualifications e
  where e.user_id = (select auth.uid())
    and e.discipline is not null
),
scored as (
  select
    j.*,
    me.age as my_age,
    -- Each predicate from `match_jobs`, kept verbatim but evaluated on its
    -- own. `coalesce(..., false)` because a comparison against a NULL profile
    -- field is NULL, and an unknown answer must count as a failure here
    -- exactly as it does there.
    coalesce(
      j.required_stream is not null
      and (
        j.required_stream = 'any'
        or exists (
          select 1 from my_streams ms
          where ms.stream = j.required_stream
            and ms.level >= j.min_qualification_level
        )
      ),
      false
    ) as ok_stream,
    coalesce(
      j.min_qualification_level is not null
      and me.highest_qualification is not null
      and me.highest_qualification >= j.min_qualification_level,
      false
    ) as ok_level,
    coalesce(
      me.age is not null
      and (j.age_min is null or me.age >= j.age_min)
      and (j.age_max is null or me.age <= j.age_max),
      false
    ) as ok_age,
    coalesce(j.gender = 'any' or me.gender is null or j.gender = me.gender, false) as ok_gender,
    coalesce(
      j.experience_years_min is null
      or coalesce(me.experience_years, 0) >= j.experience_years_min,
      false
    ) as ok_experience
  from public.jobs j, me
  where j.status = 'published'
    and (j.last_date is null or j.last_date >= current_date)
)
select
  s.id, s.slug, s.title, s.location, s.state,
  s.last_date, s.last_date_display,
  s.vacancies, s.vacancies_display,
  s.salary_min, s.salary_max, s.salary_display,
  s.application_fee, s.tags, s.is_featured, s.published_at,
  to_jsonb(o) - 'id' as organization,

  case
    when not s.ok_age        then 'age'
    when not s.ok_level      then 'qualification'
    when not s.ok_stream     then 'stream'
    when not s.ok_gender     then 'gender'
    else 'experience'
  end as blocker,

  case
    when not s.ok_age then
      coalesce(s.age_min::text, '') || '-' || coalesce(s.age_max::text, '') ||
      '|' || coalesce(s.my_age::text, '')
    when not s.ok_level then coalesce(s.min_qualification_level::text, '')
    when not s.ok_stream then coalesce(s.required_stream::text, '')
    when not s.ok_gender then s.gender::text
    else coalesce(s.experience_years_min::text, '')
  end as blocker_value

from scored s
left join public.organizations o on o.id = s.organization_id
-- Exactly one failure. Two or more and the job is not "close", it is simply
-- not for this person, and listing it would be the noise the old app's
-- "Not Eligible" section became.
where (not s.ok_stream)::int + (not s.ok_level)::int + (not s.ok_age)::int
    + (not s.ok_gender)::int + (not s.ok_experience)::int = 1
-- Closing soonest, like every other list in this app: a near-miss that closes
-- tomorrow is the one worth knowing about.
order by s.last_date asc nulls last, s.id asc
limit least(greatest(p_limit, 1), 50);
$$;

comment on function public.match_jobs_blocked is
  'Open jobs that fail exactly one of match_jobs'' hard filters, with that '
  'filter named. Relaxes nothing: the predicates are identical, and a job '
  'returned here is by construction absent from match_jobs.';

revoke all on function public.match_jobs_blocked(integer) from public;
grant execute on function public.match_jobs_blocked(integer) to authenticated;
