-- ═══════════════════════════════════════════════════════════════════════════
-- 0012 · Trim the match_jobs payload
-- ═══════════════════════════════════════════════════════════════════════════
-- 0011 built the organization with `to_jsonb(o) - 'id'`, which is every column
-- the table has: aliases, website, description, is_active, created_at,
-- updated_at. The card renders four of them. Measured on 50 rows that one
-- convenience was 14.1 kB of a 40.9 kB response — 35% of the payload, against
-- a 40 kB budget it was clearing by 36 bytes.
--
-- That is cause #1 of this rebuild reproduced inside the fix for cause #3:
-- sending columns nothing renders. `to_jsonb(row)` is the SQL spelling of
-- `select('*')`, and it deserves the same suspicion.
--
-- `score` also leaves the response. It orders the results inside the query and
-- was never read by the client; returning it published an implementation
-- detail and invited someone to start depending on it.
--
-- Replacing rather than editing 0011 in place: that migration is already
-- committed and may have been applied, and silently changing an applied
-- migration means two databases that disagree about what "0011" was.

drop function if exists public.match_jobs(integer);

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
    case
      when p.date_of_birth is null then null
      else extract(year from age(current_date, p.date_of_birth))::int
    end as age
  from public.profiles p
  where p.id = (select auth.uid())
),
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
    and (j.last_date is null or j.last_date >= current_date)

    -- Stream. NULL means the wording was not recognised — excluded, because
    -- "we are not sure" must not render as "you are eligible".
    and j.required_stream is not null
    and (
      j.required_stream = 'any'
      or exists (
        select 1 from my_streams ms
        where ms.stream = j.required_stream
          and ms.level >= j.min_qualification_level
      )
    )

    -- Level.
    and j.min_qualification_level is not null
    and me.highest_qualification is not null
    and me.highest_qualification >= j.min_qualification_level

    -- Age, against the stated window only. Category relaxations are granted
    -- per notification and this schema does not record which ones grant them,
    -- so assuming them would widen results on an assumption.
    and me.age is not null
    and (j.age_min is null or me.age >= j.age_min)
    and (j.age_max is null or me.age <= j.age_max)

    and (j.gender = 'any' or me.gender is null or j.gender = me.gender)
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

  -- Exactly the four fields the card renders. Named explicitly so adding a
  -- column to `organizations` cannot silently widen every feed response.
  jsonb_build_object(
    'slug',       o.slug,
    'name',       o.name,
    'short_name', o.short_name,
    'logo_path',  o.logo_path
  ) as organization,

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
order by
  -- The ranking, inlined. It decides order and nothing else: everything here
  -- is already eligible, so no weight can turn a non-match into a match.
  (
      case when c.tags && me.preferred_sectors then 3.0 else 0 end
    + case
        when c.state = any (me.preferred_states) then 2.0
        when c.state = me.state then 2.0
        when c.state is null or c.state = 'All India' then 0.5
        else 0
      end
    + case
        when c.last_date is null then 0
        when c.last_date - current_date <= 7  then 1.5
        when c.last_date - current_date <= 21 then 0.75
        else 0
      end
    + case when c.is_featured then 0.5 else 0 end
  ) desc,
  c.last_date asc nulls last,
  c.id desc
limit least(greatest(p_limit, 1), 50);
$$;

comment on function public.match_jobs is
  'The For You feed. Hard eligibility filters first — stream, level, age, '
  'gender, experience — then ranking over what survives. Ambiguity excludes a '
  'row rather than including it. Returns card columns only; the ranking score '
  'orders the result and is not part of the response.';

grant execute on function public.match_jobs(integer) to authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- One eligibility index, not two
-- ═══════════════════════════════════════════════════════════════════════════
-- 0011 added jobs_match_idx alongside 0004's jobs_eligibility_idx, and the two
-- overlap: both are partial indexes on published jobs over the same
-- eligibility columns. The planner promptly started preferring the new one for
-- queries written against the old one, which is how this was noticed — the
-- Module 1 index assertion began failing while the query was still perfectly
-- well served.
--
-- Two indexes covering the same ground is a write-throughput cost and a
-- storage cost for no read benefit, and ingest writes this table constantly.
--
-- Reordering so `required_stream` comes last makes the old index an exact
-- prefix of this one, which is what makes it genuinely redundant rather than
-- merely similar: a lookup on (status, level, age) uses the same leading
-- columns it always did.
drop index if exists public.jobs_match_idx;
drop index if exists public.jobs_eligibility_idx;

create index jobs_eligibility_idx
  on public.jobs (status, min_qualification_level, age_min, age_max, required_stream)
  where status = 'published';

comment on index public.jobs_eligibility_idx is
  'Serves both the Module 1 eligibility prefilter and Module 8 matching. '
  'required_stream is last so the original (status, level, age_min, age_max) '
  'lookup remains a prefix scan.';
