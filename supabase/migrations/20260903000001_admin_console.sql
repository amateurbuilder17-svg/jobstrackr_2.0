-- ═══════════════════════════════════════════════════════════════════════════
-- 0034 · The admin console
-- ═══════════════════════════════════════════════════════════════════════════
-- The old project's admin was one 12,505-line component that did every one of
-- its jobs in the browser. `useJobs` pulled all ~5,231 rows uncached on mount,
-- and then:
--
--   • the vacancy checker ran a title regex over every row in JavaScript
--   • the duplicate finder built a Map over every row in JavaScript
--   • the last-date checker fetched `job_metadata` for every candidate
--   • the logo page pulled every job to list departments without a logo
--   • the users page selected `profiles.*` for every account
--
-- All five answers are small — a few dozen rows each. It was the *questions*
-- that were expensive, because they were asked from the wrong side of the
-- network. Every function below asks them in Postgres and returns only the
-- answer. The vacancy checker goes from ~14 MB to about 8 kB.
--
-- Every one of these is `security definer` and granted to `service_role` only,
-- exactly as `admin_table_stats` is: they are reachable through the secret-key
-- client, and only after `hasRole('admin')` has already returned true in
-- TypeScript. A session token cannot call any of them.


-- ═══════════════════════════════════════════════════════════════════════════
-- Jobs · the vacancy checker
-- ═══════════════════════════════════════════════════════════════════════════
-- A port of the old `extractVacanciesFromTitle`, behaviour for behaviour.
-- Scraped titles carry the post count in the text — "…Recruitment 2026 - Apply
-- Online for 70 Posts" — and `jobs.vacancies` disagrees with it often enough
-- that the old project shipped a whole checker for it.
--
-- Three details are load-bearing and are the reason this is a faithful port
-- rather than a fresh regex:
--
--   1. The search is anchored *after* the word "Recruitment", and the year that
--      immediately follows it is stripped. Without that, "Recruitment 2026"
--      reads as 2,026 vacancies.
--   2. A 4-digit year is skipped when any other candidate exists, but a lone
--      year-like number is still returned — "2000 Posts" is a real vacancy
--      count.
--   3. The gap between the number and the keyword may only contain
--      non-numeric words, so an intervening date can never bridge to a keyword.
--
-- Postgres regex notes, since they differ from JavaScript's: word boundary is
-- `\y`, not `\b` (which means backspace here), and non-greedy quantifiers such
-- as `{0,10}?` are supported. Verified against the same title corpus the old
-- checker ran on.
create or replace function public.admin_vacancy_from_title(p_title text)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  -- Deliberately excludes ambiguous tokens like "no"/"nos", which match
  -- "Notification" and "Now". `\y` after the group keeps "Posts" and rejects
  -- "Posted".
  k_words constant text :=
    'posts?|vacanc(?:y|ies)|vacant|positions?|seats?|openings?|intakes?';
  -- A number with optional grouping commas, so both 18,799 and 1,55,000 parse.
  k_num   constant text := '(\d[\d,]*\d|\d)';

  v_scope    text;
  v_anchor   integer;
  v_match    text[];
  v_n        integer;
  v_fallback integer := null;
begin
  if p_title is null or btrim(p_title) = '' then
    return null;
  end if;

  -- Anchor after "Recruitment"/"Recruitments" and drop the year that follows.
  v_anchor := coalesce(nullif(position(substring(p_title from '(?i)\yrecruitments?\y') in p_title), 0), 0);
  if v_anchor > 0 then
    v_scope := substring(p_title from v_anchor + length(substring(p_title from '(?i)\yrecruitments?\y')));
    v_scope := regexp_replace(v_scope, '^\s*[:—–-]?\s*(?:19|20)\d{2}\y', '');
  else
    v_scope := p_title;
  end if;

  -- Pattern 1 — number, then up to ten non-numeric words, then a keyword.
  for v_match in
    select m from regexp_matches(
      v_scope,
      k_num || '\+?(?:\s+[A-Za-z][^\s]*){0,10}?\s*(?:' || k_words || ')\y',
      'gi'
    ) as m
  loop
    v_n := nullif(regexp_replace(v_match[1], ',', '', 'g'), '')::integer;
    if v_n is not null and v_n > 0 then
      -- A 4-digit year is a candidate of last resort, never a preferred one.
      if v_n between 1990 and 2099 and length(v_match[1]) = 4 then
        v_fallback := coalesce(v_fallback, v_n);
      else
        return v_n;
      end if;
    end if;
  end loop;
  if v_fallback is not null then
    return v_fallback;
  end if;

  -- Pattern 2 — keyword, a separator, then the number ("Vacancy: 500").
  for v_match in
    select m from regexp_matches(
      v_scope,
      '(?:' || k_words || ')\y\s*[:-]\s*\+?\s*' || k_num,
      'gi'
    ) as m
  loop
    v_n := nullif(regexp_replace(v_match[1], ',', '', 'g'), '')::integer;
    if v_n is not null and v_n > 0 then
      if v_n between 1990 and 2099 and length(v_match[1]) = 4 then
        v_fallback := coalesce(v_fallback, v_n);
      else
        return v_n;
      end if;
    end if;
  end loop;

  return v_fallback;
end;
$$;

comment on function public.admin_vacancy_from_title is
  'Reads a post count out of a scraped job title. A port of the old admin '
  'page''s extractVacanciesFromTitle, moved into the database so the checker '
  'returns mismatches instead of the whole jobs table.';


-- Rows where the title says one number and the column says another.
--
-- The `where` clause is what makes this cheap: the function runs per row, but
-- only the disagreements cross the network. On production that is roughly 40
-- rows out of 5,800.
create or replace function public.admin_vacancy_mismatches(
  p_limit  integer default 50,
  p_offset integer default 0
)
returns table (
  job_id            uuid,
  slug              text,
  title             text,
  stored            integer,
  extracted         integer,
  vacancies_display text,
  total             bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with flagged as (
    select
      j.id,
      j.slug,
      j.title,
      j.vacancies,
      j.vacancies_display,
      public.admin_vacancy_from_title(j.title) as parsed
    from public.jobs j
    where j.status <> 'archived'
  ),
  mismatched as (
    select * from flagged
    where parsed is not null
      and (vacancies is null or vacancies <> parsed)
  )
  select
    m.id,
    m.slug,
    m.title,
    m.vacancies,
    m.parsed,
    m.vacancies_display,
    count(*) over ()
  from mismatched m
  order by m.parsed desc, m.title
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.admin_vacancy_mismatches(integer, integer)
  from public, anon, authenticated;
grant execute on function public.admin_vacancy_mismatches(integer, integer) to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- Jobs · the duplicate preview
-- ═══════════════════════════════════════════════════════════════════════════
-- The same grouping and the same survivor ranking as `merge_duplicate_jobs`
-- (0027/0028) — deliberately, so this page shows exactly what pressing Merge
-- would do rather than an approximation of it. If the two ever diverge the page
-- becomes a lie about its own button.
--
-- Paged by *group*, not by row, so a group is never split across two pages with
-- its survivor on the other one.
create or replace function public.admin_duplicate_groups(
  p_limit  integer default 20,
  p_offset integer default 0
)
returns table (
  group_key    text,
  group_size   integer,
  job_id       uuid,
  slug         text,
  title        text,
  org_name     text,
  last_date    date,
  source_url   text,
  created_at   timestamptz,
  is_canonical boolean,
  total_groups bigint,
  total_rows   bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with ranked as (
    select
      j.id,
      j.slug,
      j.title,
      j.last_date,
      j.source_url,
      j.created_at,
      j.organization_id,
      coalesce(j.organization_id::text, 'no-org') || '|' || lower(btrim(j.title)) as gkey,
      first_value(j.id) over (
        partition by j.organization_id, lower(btrim(j.title))
        order by
          (j.last_date is not null) desc,
          (j.source_url is not null and j.source_url !~* '^[a-z]+://[^/]+/?$') desc,
          (j.source_url !~* 'freejobalert\.com') desc,
          j.created_at desc,
          j.id
      ) as canonical_id,
      count(*) over (partition by j.organization_id, lower(btrim(j.title)))::integer as grp
    from public.jobs j
    where j.organization_id is not null

    union all

    select
      j.id,
      j.slug,
      j.title,
      j.last_date,
      j.source_url,
      j.created_at,
      j.organization_id,
      'no-org|' || lower(btrim(j.title)) as gkey,
      first_value(j.id) over (
        partition by lower(btrim(j.title))
        order by
          (j.last_date is not null) desc,
          (j.source_url is not null and j.source_url !~* '^[a-z]+://[^/]+/?$') desc,
          (j.source_url !~* 'freejobalert\.com') desc,
          j.created_at desc,
          j.id
      ) as canonical_id,
      count(*) over (partition by lower(btrim(j.title)))::integer as grp
    from public.jobs j
    where j.organization_id is null
  ),
  dupes as (
    select * from ranked where grp > 1
  ),
  -- Group keys for this page only. Ordered biggest-first, because the largest
  -- group is where a single decision removes the most rows.
  page_keys as (
    select gkey, max(grp) as grp, count(*) over () as total_groups
    from dupes
    group by gkey
    order by max(grp) desc, gkey
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select
    d.gkey,
    d.grp,
    d.id,
    d.slug,
    d.title,
    o.short_name,
    d.last_date,
    d.source_url,
    d.created_at,
    d.id = d.canonical_id,
    pk.total_groups,
    (select count(*) from dupes)
  from dupes d
  join page_keys pk on pk.gkey = d.gkey
  left join public.organizations o on o.id = d.organization_id
  order by d.grp desc, d.gkey, (d.id = d.canonical_id) desc, d.created_at desc;
$$;

revoke all on function public.admin_duplicate_groups(integer, integer)
  from public, anon, authenticated;
grant execute on function public.admin_duplicate_groups(integer, integer) to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- Jobs · listings with no closing date
-- ═══════════════════════════════════════════════════════════════════════════
-- `jobs.last_date` is null on a listing whose scrape did not produce a parseable
-- date — but the date is usually still there, in `job_details.important_dates`,
-- as the free text the notification printed ("30 Jun 2026", "Last Date to Apply").
--
-- The parse stays in TypeScript: `important_dates` is `[{event, date}]` with a
-- deliberately free-text `date`, and a plpgsql date parser for "Third week of
-- March" would be a worse version of the one that already exists. What this
-- function does is the expensive half — find the candidates and hand back only
-- the date entries, never the whole detail row.
create or replace function public.admin_jobs_missing_last_date(
  p_limit integer default 100
)
returns table (
  job_id          uuid,
  slug            text,
  title           text,
  display         text,
  important_dates jsonb,
  total           bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with candidates as (
    select j.id, j.slug, j.title, j.last_date_display, d.important_dates
    from public.jobs j
    join public.job_details d on d.job_id = j.id
    where j.last_date is null
      and j.status <> 'archived'
      and d.important_dates is not null
      and jsonb_array_length(d.important_dates) > 0
  )
  select
    c.id,
    c.slug,
    c.title,
    c.last_date_display,
    c.important_dates,
    count(*) over ()
  from candidates c
  order by c.title
  limit greatest(1, least(coalesce(p_limit, 100), 200));
$$;

revoke all on function public.admin_jobs_missing_last_date(integer)
  from public, anon, authenticated;
grant execute on function public.admin_jobs_missing_last_date(integer) to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- People
-- ═══════════════════════════════════════════════════════════════════════════
-- `profiles` is owner-only under RLS (0010) and holds encrypted identity
-- numbers, so there is no version of an admin users page that selects from it
-- directly. This names its columns instead, and the names are the policy: full
-- name, address, qualification, state, join date, AI usage. No Aadhaar, no PAN,
-- no passport, no phone, no date of birth, no address — not redacted in the UI,
-- never sent.
--
-- The address does come from `auth.users`, which is why this is `security
-- definer`: nothing else can read it.
create or replace function public.admin_user_stats()
returns table (
  total_users     bigint,
  today_users     bigint,
  week_users      bigint,
  onboarded_users bigint,
  ai_calls_today  bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.profiles),
    (select count(*) from public.profiles where created_at >= (now() at time zone 'Asia/Kolkata')::date),
    (select count(*) from public.profiles where created_at >= now() - interval '7 days'),
    (select count(*) from public.profiles where onboarding_completed),
    (select coalesce(sum(used), 0) from public.ai_usage
      where day = (now() at time zone 'Asia/Kolkata')::date);
$$;

revoke all on function public.admin_user_stats() from public, anon, authenticated;
grant execute on function public.admin_user_stats() to service_role;


create or replace function public.admin_list_users(
  p_limit  integer default 50,
  p_offset integer default 0,
  p_query  text    default null
)
returns table (
  user_id               uuid,
  email                 text,
  full_name             text,
  highest_qualification text,
  state                 text,
  onboarding_completed  boolean,
  created_at            timestamptz,
  last_sign_in_at       timestamptz,
  ai_calls              bigint,
  total                 bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with matched as (
    select p.id, p.full_name, p.highest_qualification, p.state,
           p.onboarding_completed, p.created_at, u.email, u.last_sign_in_at
    from public.profiles p
    join auth.users u on u.id = p.id
    where p_query is null
       or btrim(p_query) = ''
       or p.full_name ilike '%' || btrim(p_query) || '%'
       or u.email     ilike '%' || btrim(p_query) || '%'
  )
  select
    m.id,
    m.email::text,
    m.full_name,
    m.highest_qualification::text,
    m.state,
    m.onboarding_completed,
    m.created_at,
    m.last_sign_in_at,
    -- Aggregated in a lateral rather than a join, so a heavy user's 300 usage
    -- rows never multiply their profile row across the page.
    coalesce(a.calls, 0),
    count(*) over ()
  from matched m
  left join lateral (
    select sum(used) as calls from public.ai_usage where user_id = m.id
  ) a on true
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.admin_list_users(integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.admin_list_users(integer, integer, text) to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- AI usage
-- ═══════════════════════════════════════════════════════════════════════════
-- The old project logged every AI search as its own row in
-- `ai_job_discover_logs` — query text, latency, parse result — and the admin
-- page then read 500 of them per mount to draw four numbers. `ai_usage` here is
-- already a daily rollup per (user, kind), so the same page is a `group by`
-- over a table that grows by users-times-kinds per day rather than by request.
--
-- The query text is not stored at all, and this is the moment to say why:
-- people type their qualifications, their district and sometimes their name
-- into that box. A log of it is a PII store that exists only to populate a
-- dashboard nobody reads twice.
create or replace function public.admin_ai_usage(p_days integer default 14)
returns table (
  day       date,
  kind      text,
  calls     bigint,
  users     bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    u.day,
    u.kind,
    sum(u.used)::bigint,
    count(distinct u.user_id)::bigint
  from public.ai_usage u
  where u.day >= (now() at time zone 'Asia/Kolkata')::date
                 - (greatest(1, least(coalesce(p_days, 14), 90)) || ' days')::interval
  group by u.day, u.kind
  order by u.day desc, u.kind;
$$;

revoke all on function public.admin_ai_usage(integer) from public, anon, authenticated;
grant execute on function public.admin_ai_usage(integer) to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- Logos
-- ═══════════════════════════════════════════════════════════════════════════
-- The old logo page pulled every job so it could list the departments with no
-- matching logo, then matched them in the browser with a fuzzy string helper.
-- Here the relationship is a foreign key — a job belongs to an organisation and
-- the organisation owns the logo — so "which bodies have no logo" is a `where
-- logo_path is null`, and "does it matter" is the job count beside it.
--
-- Ordered by job count, which is the whole point: a body with 400 listings and
-- no logo is 400 pages showing initials, and a body with one is not worth
-- anyone's afternoon.
create or replace function public.admin_logo_coverage()
returns table (
  total_orgs     bigint,
  with_logo      bigint,
  jobs_with_logo bigint,
  jobs_total     bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*) from public.organizations where is_active),
    (select count(*) from public.organizations where is_active and logo_path is not null),
    (select count(*) from public.jobs j
       join public.organizations o on o.id = j.organization_id
      where o.logo_path is not null and j.status = 'published'),
    (select count(*) from public.jobs where status = 'published');
$$;

revoke all on function public.admin_logo_coverage() from public, anon, authenticated;
grant execute on function public.admin_logo_coverage() to service_role;


create or replace function public.admin_list_organizations(
  p_limit    integer default 50,
  p_offset   integer default 0,
  p_query    text    default null,
  p_missing  boolean default true
)
returns table (
  id         uuid,
  slug       text,
  name       text,
  short_name text,
  logo_path  text,
  job_count  bigint,
  total      bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with matched as (
    select o.id, o.slug, o.name, o.short_name, o.logo_path
    from public.organizations o
    where o.is_active
      and (not coalesce(p_missing, true) or o.logo_path is null)
      and (
        p_query is null or btrim(p_query) = ''
        or o.name       ilike '%' || btrim(p_query) || '%'
        or o.short_name ilike '%' || btrim(p_query) || '%'
      )
  )
  select
    m.id, m.slug, m.name, m.short_name, m.logo_path,
    coalesce(c.n, 0),
    count(*) over ()
  from matched m
  left join lateral (
    select count(*) as n from public.jobs j
    where j.organization_id = m.id and j.status = 'published'
  ) c on true
  order by coalesce(c.n, 0) desc, m.name
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.admin_list_organizations(integer, integer, text, boolean)
  from public, anon, authenticated;
grant execute on function public.admin_list_organizations(integer, integer, text, boolean)
  to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- Discover · source health
-- ═══════════════════════════════════════════════════════════════════════════
-- `scraper_sources` has existed since 0009 and nothing has ever shown it. This
-- joins each source to what has actually arrived from it, so the page can
-- answer the only question worth asking of a feed: is it still landing rows?
--
-- Attribution is by **host**, matched against `exam_updates.source_url`. That is
-- a real relationship rather than an inferred one — the row carries the URL it
-- was scraped from — and it is the reason this does not join `sync_runs`
-- instead. `sync_runs.kind` is the feed ('jobs' / 'exam_updates'), not the
-- source: joining on it would give every source in a feed identical numbers and
-- present them as per-source figures. A dashboard that invents attribution is
-- worse than one that admits it has none.
--
-- Note what is *not* here. The old Discover tab drove the scrape itself from
-- the browser — load a listing page, then one fetch per article, then one
-- insert per article, with a "Scrape All" button that could fire two hundred
-- serverless invocations from a single click. That is the shape that does not
-- survive a Hobby plan. Ingestion runs on a schedule and writes `sync_runs`;
-- this page reads the result.
create or replace function public.admin_source_health()
returns table (
  id              uuid,
  name            text,
  url             text,
  host            text,
  category        text,
  is_active       boolean,
  limit_per_run   integer,
  last_scraped_at timestamptz,
  rows_total      bigint,
  rows_7d         bigint,
  last_row_at     timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with sources as (
    select
      s.*,
      -- 'https://www.freejobalert.com/new-updates/' → 'freejobalert.com'.
      regexp_replace(
        lower(coalesce(substring(s.url from '^[a-zA-Z]+://([^/?#]+)'), s.url)),
        '^www\.', ''
      ) as host
    from public.scraper_sources s
  )
  select
    s.id, s.name, s.url, s.host, s.category::text, s.is_active,
    s.limit_per_run, s.last_scraped_at,
    coalesce(u.total, 0),
    coalesce(u.recent, 0),
    u.last_at
  from sources s
  left join lateral (
    select
      count(*)                                                      as total,
      count(*) filter (where eu.scraped_at >= now() - interval '7 days') as recent,
      max(eu.scraped_at)                                            as last_at
    from public.exam_updates eu
    where regexp_replace(
            lower(coalesce(substring(eu.source_url from '^[a-zA-Z]+://([^/?#]+)'), '')),
            '^www\.', ''
          ) = s.host
  ) u on true
  order by s.is_active desc, coalesce(u.recent, 0) desc, s.name;
$$;

revoke all on function public.admin_source_health() from public, anon, authenticated;
grant execute on function public.admin_source_health() to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- Sync run history, by day
-- ═══════════════════════════════════════════════════════════════════════════
-- The old Discover tab's "Fetched by Date" table, which it built by reading
-- every sync-log row into the browser and reducing it there.
create or replace function public.admin_sync_by_day(p_days integer default 14)
returns table (
  day       date,
  kind      text,
  runs      bigint,
  failures  bigint,
  seen      bigint,
  inserted  bigint,
  updated   bigint,
  unchanged bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (sr.started_at at time zone 'Asia/Kolkata')::date,
    sr.kind,
    count(*),
    count(*) filter (where sr.status = 'failed'),
    coalesce(sum(sr.rows_seen), 0),
    coalesce(sum(sr.rows_inserted), 0),
    coalesce(sum(sr.rows_updated), 0),
    coalesce(sum(sr.rows_unchanged), 0)
  from public.sync_runs sr
  where sr.started_at >= now()
        - (greatest(1, least(coalesce(p_days, 14), 90)) || ' days')::interval
  group by 1, 2
  order by 1 desc, 2;
$$;

revoke all on function public.admin_sync_by_day(integer) from public, anon, authenticated;
grant execute on function public.admin_sync_by_day(integer) to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- Closing two functions that were left open
-- ═══════════════════════════════════════════════════════════════════════════
-- Found while wiring the maintenance buttons below, which call both of these.
-- Postgres grants EXECUTE on a new function to PUBLIC unless told otherwise,
-- and neither 0027/0028 nor 0009 said otherwise — so on a live project any
-- signed-in account (and `anon`, before that) could call two `security definer`
-- functions that delete rows:
--
--   merge_duplicate_jobs()    deletes every non-canonical row in every
--                             duplicate group — ~3,900 rows on production —
--                             after reassigning their children.
--   prune_operational_data()  deletes aged rows from the operational tables.
--
-- Neither is destructive in a way that loses user data (the merge reassigns
-- saved jobs, tracker entries and reminders before deleting), and neither is
-- likely to have been found. But "hard to find" is not an access control, and
-- both are one `rpc()` call away from any browser holding a session.
--
-- Nothing legitimate loses access: both are called from /api/cron/prune through
-- the secret-key client, which is `service_role`, and the admin buttons added
-- with this migration go through the same client after `hasRole('admin')`.
revoke all on function public.merge_duplicate_jobs() from public, anon, authenticated;
grant execute on function public.merge_duplicate_jobs() to service_role;

revoke all on function public.prune_operational_data() from public, anon, authenticated;
grant execute on function public.prune_operational_data() to service_role;
