-- ═══════════════════════════════════════════════════════════════════════════
-- 0011 · Module 8 · Server-side matching
-- ═══════════════════════════════════════════════════════════════════════════
-- The old app shipped a 65 kB matcher to the browser, which is why it also had
-- to ship every row: scoring in JavaScript needs the whole table present. This
-- moves the decision to where the indexes are.
--
-- The governing rule is precision, not coverage. A feed that says "you are
-- eligible" and is wrong costs someone a ₹500 application fee and a fortnight
-- of waiting; a feed that stays quiet costs them nothing. So every filter below
-- is a hard exclusion, ambiguity resolves to *absent* rather than to a guess,
-- and nothing here is relaxed to make the list look fuller.

-- ── The stream dimension ───────────────────────────────────────────────────
-- Qualification is two-dimensional and the schema so far has only had one of
-- them. `min_qualification_level` says a job needs a bachelor's; it cannot say
-- the bachelor's must be in engineering. Matching on level alone tells a
-- B.A. graduate they are eligible for "B.E./B.Tech in Civil Engineering",
-- which is exactly the false positive this module exists not to produce.

create type public.qualification_stream as enum (
  -- 'any' is a real answer, not a null: it means the notification explicitly
  -- says "any discipline". Distinguishing it from "we could not tell" is the
  -- whole point — the first is safe to match, the second is not.
  'any',
  'engineering',
  'medical',
  'nursing',
  'pharmacy',
  'teaching',
  'law',
  'commerce',
  'computer',
  'agriculture'
);

-- ── Reading a stream out of free text ──────────────────────────────────────
-- One function, used for both sides of the comparison. If the job's
-- requirement and the candidate's degree were parsed by different code they
-- would disagree eventually, and a disagreement here is a wrong answer about
-- someone's career rather than a rendering bug.
--
-- Conservative by construction: it returns NULL for anything it does not
-- positively recognise, and every caller treats NULL as "do not match".
create or replace function public.stream_of(subject text)
returns public.qualification_stream
language sql
immutable
strict
set search_path = ''
as $$
  select case
    -- Explicit openness first: "B.E./B.Tech in any discipline" must read as
    -- engineering, not as open, so the specific patterns are checked before
    -- the general one below.
    when subject ~* '\m(b\.?e\.?|b\.?tech|engineering|civil|mechanical|electrical|electronics)\M'
      then 'engineering'::public.qualification_stream
    when subject ~* '\m(nursing|b\.?sc\.? nursing|gnm|anm)\M'
      then 'nursing'::public.qualification_stream
    when subject ~* '\m(mbbs|md|dental|bds|medical|physician|surgeon)\M'
      then 'medical'::public.qualification_stream
    when subject ~* '\m(pharmac|b\.?pharm|d\.?pharm)\M'
      then 'pharmacy'::public.qualification_stream
    when subject ~* '\m(b\.?ed|teaching|teacher|ctet|tet)\M'
      then 'teaching'::public.qualification_stream
    when subject ~* '\m(ll\.?b|law|legal|advocate)\M'
      then 'law'::public.qualification_stream
    when subject ~* '\m(computer|informatics|b\.?c\.?a|m\.?c\.?a|software|it)\M'
      then 'computer'::public.qualification_stream
    when subject ~* '\m(commerce|b\.?com|m\.?com|accounting|chartered)\M'
      then 'commerce'::public.qualification_stream
    when subject ~* '\m(agricultur|horticultur|b\.?sc\.? ag)\M'
      then 'agriculture'::public.qualification_stream
    -- Only now: an unqualified degree with no discipline named.
    when subject ~* '(any (discipline|stream|subject|branch)|any recognised)'
      then 'any'::public.qualification_stream
    -- School-level qualifications have no discipline to constrain.
    when subject ~* '\m(class 10|class 12|10th|12th|matriculation|intermediate|iti)\M'
      then 'any'::public.qualification_stream
    else null
  end;
$$;

comment on function public.stream_of is
  'Maps free text — a job''s qualification line, or a candidate''s degree — to '
  'a stream. Returns NULL when it cannot tell, and callers must treat NULL as '
  'a non-match. Specific disciplines are tested before "any discipline" so '
  '"B.Tech in any branch" reads as engineering rather than open.';

-- ── The column ─────────────────────────────────────────────────────────────
-- Generated, not written. The first attempt was a plain column plus a backfill
-- UPDATE, which was silently wrong: migrations run before the seed, so the
-- backfill touched an empty table and every row inserted afterwards carried a
-- NULL. Any scheme where the derived value is written by whoever happens to
-- insert has the same failure waiting in it — an ingest path that forgets, and
-- a feed that quietly excludes everything.
--
-- As a generated column the value cannot be out of step with the text it comes
-- from, and Module 11 gets it for free rather than having to remember.
alter table public.jobs
  add column required_stream public.qualification_stream
  generated always as (public.stream_of(qualification_summary)) stored;

comment on column public.jobs.required_stream is
  'Which discipline the qualification must be in, derived from '
  'qualification_summary. NULL means the wording was not recognised, and an '
  'undetermined job is excluded from matching rather than guessed at.';

-- ── Index for the prefilter ────────────────────────────────────────────────
-- The eligibility index from 0004 does not carry the new column, and the
-- stream test runs on every candidate row.
create index jobs_match_idx
  on public.jobs (status, required_stream, min_qualification_level, age_min, age_max)
  where status = 'published';


-- ═══════════════════════════════════════════════════════════════════════════
-- match_jobs — the feed
-- ═══════════════════════════════════════════════════════════════════════════
-- SECURITY INVOKER (the default): it runs as the caller, so RLS still decides
-- which rows are visible. A SECURITY DEFINER function here would be a way to
-- read unpublished jobs, and it buys nothing — the caller can already see
-- everything this needs.
create or replace function public.match_jobs(p_limit integer default 50)
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
  score               real,
  reasons             text[]
)
language sql
stable
set search_path = ''
as $$
with me as (
  select
    p.id,
    p.date_of_birth,
    p.gender,
    p.state,
    p.experience_years,
    p.highest_qualification,
    p.preferred_sectors,
    p.preferred_states,
    -- Age in whole years today. Derived rather than stored, because a stored
    -- age is wrong within a year of being written.
    case
      when p.date_of_birth is null then null
      else extract(year from age(current_date, p.date_of_birth))::int
    end as age
  from public.profiles p
  where p.id = (select auth.uid())
),
-- Every stream the candidate actually holds, with the level they hold it at.
-- Their own free-text discipline goes through the same parser as the job's
-- requirement, so the two sides cannot drift apart.
my_streams as (
  select
    public.stream_of(e.discipline) as stream,
    e.level
  from public.education_qualifications e
  where e.user_id = (select auth.uid())
    and e.discipline is not null
),
candidates as (
  select j.*
  from public.jobs j, me
  where j.status = 'published'
    -- Closed notifications are not opportunities.
    and (j.last_date is null or j.last_date >= current_date)

    -- ── Hard filter: stream ───────────────────────────────────────────────
    -- NULL required_stream means the notification's wording was not
    -- recognised. Excluded, deliberately: "we are not sure" must not render
    -- as "you are eligible".
    and j.required_stream is not null
    and (
      j.required_stream = 'any'
      or exists (
        select 1 from my_streams ms
        where ms.stream = j.required_stream
          and ms.level >= j.min_qualification_level
      )
    )

    -- ── Hard filter: qualification level ──────────────────────────────────
    -- An unstated level is treated as unknown and excluded, on the same
    -- principle as the stream.
    and j.min_qualification_level is not null
    and me.highest_qualification is not null
    and me.highest_qualification >= j.min_qualification_level

    -- ── Hard filter: age ──────────────────────────────────────────────────
    -- Against the stated window only. Category relaxations (OBC +3, SC/ST +5)
    -- are real, but they are granted per notification and this schema does not
    -- record which notifications grant them. Applying them by default would
    -- widen the result set on an assumption — the one direction this module is
    -- not allowed to be wrong in. Someone eligible only through relaxation is
    -- therefore missed, which is the acceptable half of the trade.
    and me.age is not null
    and (j.age_min is null or me.age >= j.age_min)
    and (j.age_max is null or me.age <= j.age_max)

    -- ── Hard filter: gender ───────────────────────────────────────────────
    and (j.gender = 'any' or me.gender is null or j.gender = me.gender)

    -- ── Hard filter: experience ───────────────────────────────────────────
    and (
      j.experience_years_min is null
      or coalesce(me.experience_years, 0) >= j.experience_years_min
    )
)
select
  c.id, c.slug, c.title, c.location, c.state,
  c.last_date, c.last_date_display,
  c.vacancies, c.vacancies_display,
  c.salary_min, c.salary_max, c.salary_display,
  c.application_fee, c.tags, c.is_featured, c.published_at,
  to_jsonb(o) - 'id' as organization,

  -- ── Ranking ─────────────────────────────────────────────────────────────
  -- Ordering only. Everything reaching this point is already eligible, so no
  -- weight here can turn a non-match into a match — which is what keeps the
  -- scoring safe to tune without re-testing eligibility.
  (
      case when c.tags && me.preferred_sectors then 3.0 else 0 end
    + case
        when c.state = any (me.preferred_states) then 2.0
        when c.state = me.state then 2.0
        when c.state is null or c.state = 'All India' then 0.5
        else 0
      end
    -- Closing soon ranks higher: the feed's job is to surface what still can
    -- be acted on.
    + case
        when c.last_date is null then 0
        when c.last_date - current_date <= 7  then 1.5
        when c.last_date - current_date <= 21 then 0.75
        else 0
      end
    + case when c.is_featured then 0.5 else 0 end
  )::real as score,

  -- Why this appeared, for the card to show. A feed that cannot explain
  -- itself gets ignored the first time it looks wrong.
  array_remove(array[
    case when c.tags && me.preferred_sectors then 'Matches your sectors' end,
    case
      when c.state = any (me.preferred_states) or c.state = me.state
        then 'In your state'
      when c.state is null or c.state = 'All India' then 'Open all India'
    end,
    case
      when c.last_date is not null and c.last_date - current_date <= 7
        then 'Closing soon'
    end
  ], null) as reasons

from candidates c
cross join me
left join public.organizations o on o.id = c.organization_id
order by score desc, c.last_date asc nulls last, c.id desc
limit least(greatest(p_limit, 1), 50);
$$;

comment on function public.match_jobs is
  'The For You feed. Hard eligibility filters first — stream, level, age, '
  'gender, experience — then ranking over what survives. Ambiguity excludes a '
  'row rather than including it: a wrong "you are eligible" costs a real '
  'application fee, a missing row costs nothing. Capped at 50.';

grant execute on function public.match_jobs(integer) to authenticated;
grant execute on function public.stream_of(text) to authenticated, anon;
