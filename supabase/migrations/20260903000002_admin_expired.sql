-- ═══════════════════════════════════════════════════════════════════════════
-- 0035 · The expired-listings page
-- ═══════════════════════════════════════════════════════════════════════════
-- The old admin's "Expired" tab existed to keep the jobs table from growing
-- without bound: find listings whose window shut, tick them, delete them. It
-- did the finding and the sorting in the browser, over the same ~5,231-row
-- payload every other tab shared.
--
-- Two things are different here, and the second one matters more.
--
-- **Expiry is not a filter any more.** `close_expired_jobs()` (0016) runs at the
-- top of every ingest and moves a published listing past its closing date to
-- `closed`. A visitor never sees an expired job in a feed, so this page is no
-- longer about hiding them — it is about deciding what to do with the ones that
-- have piled up.
--
-- **Deleting a job is not free.** Seven tables reference `jobs`, and two of them
-- cascade into somebody's personal data:
--
--     saved_jobs           on delete cascade  →  a shortlist entry vanishes
--     user_calendar_events on delete cascade  →  a reminder vanishes
--
-- The old tab deleted in chunks of 100 with no idea which rows carried either.
-- Someone who saved a listing in March and kept it for their records simply
-- lost it, silently, with nothing in the UI that could have warned the admin.
--
-- So this function returns those two counts per row. The page uses them to
-- decide what it will let you press: archive is always available and reversible,
-- delete is offered only for rows nobody has touched. That is the entire reason
-- the counts are computed in the database rather than assumed to be zero.

create or replace function public.admin_expired_jobs(
  p_limit  integer default 50,
  p_offset integer default 0,
  p_year   integer default null,
  p_query  text    default null,
  -- 'oldest' (default), 'newest', or 'smallest' — fewest vacancies first, which
  -- is how the old tab found the low-value rows worth clearing out.
  p_sort   text    default 'oldest'
)
returns table (
  job_id     uuid,
  slug       text,
  title      text,
  org_name   text,
  status     text,
  last_date  date,
  created_at timestamptz,
  vacancies  integer,
  saves      bigint,
  reminders  bigint,
  total      bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with expired as (
    select j.id, j.slug, j.title, j.status, j.last_date, j.created_at,
           j.vacancies, j.organization_id
    from public.jobs j
    where j.last_date is not null
      -- IST, matching `close_expired_jobs`. A UTC comparison would call a
      -- listing expired five and a half hours before it actually shut.
      and j.last_date < (timezone('Asia/Kolkata', now()))::date
      and (p_year is null or extract(year from j.last_date) = p_year)
      and (
        p_query is null or btrim(p_query) = ''
        or j.title ilike '%' || btrim(p_query) || '%'
      )
  )
  select
    e.id, e.slug, e.title, o.short_name, e.status::text,
    e.last_date, e.created_at, e.vacancies,
    coalesce(s.n, 0),
    coalesce(c.n, 0),
    count(*) over ()
  from expired e
  left join public.organizations o on o.id = e.organization_id
  -- Two lateral counts rather than two joins: a job saved by forty people would
  -- otherwise appear forty times, and the page would report forty expired
  -- listings where there is one.
  left join lateral (
    select count(*) as n from public.saved_jobs sj where sj.job_id = e.id
  ) s on true
  left join lateral (
    select count(*) as n from public.user_calendar_events ce where ce.job_id = e.id
  ) c on true
  order by
    case when p_sort = 'newest'   then e.last_date end desc nulls last,
    case when p_sort = 'smallest' then coalesce(e.vacancies, 0) end asc nulls first,
    -- The default, and the tiebreak for both of the above: oldest first, which
    -- is the order you would work through them in.
    e.last_date asc,
    e.id
  limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.admin_expired_jobs(integer, integer, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_expired_jobs(integer, integer, integer, text, text)
  to service_role;


-- How many, and how many are safe to remove.
--
-- `unreferenced` is the number the page's delete button is sized by: rows that
-- nobody has saved and nobody has a reminder for. Everything else is archive-only.
create or replace function public.admin_expired_summary()
returns table (
  total_expired bigint,
  unreferenced  bigint,
  saved_by_users bigint,
  still_published bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with expired as (
    select j.id, j.status
    from public.jobs j
    where j.last_date is not null
      and j.last_date < (timezone('Asia/Kolkata', now()))::date
  ),
  marked as (
    select
      e.id,
      e.status,
      exists (select 1 from public.saved_jobs sj where sj.job_id = e.id)
        or exists (select 1 from public.user_calendar_events ce where ce.job_id = e.id)
        as referenced
    from expired e
  )
  select
    count(*),
    count(*) filter (where not referenced),
    count(*) filter (where referenced),
    -- Should be zero: `close_expired_jobs` runs every ingest. A non-zero here
    -- means ingestion has not run, which is worth seeing on this page rather
    -- than discovering from a stale listing on the site.
    count(*) filter (where status = 'published')
  from marked;
$$;

revoke all on function public.admin_expired_summary() from public, anon, authenticated;
grant execute on function public.admin_expired_summary() to service_role;


-- Years with expired listings, for the filter. Returned with counts so the
-- control says how much is behind each option instead of making you click to
-- find out.
create or replace function public.admin_expired_years()
returns table (year integer, n bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select extract(year from j.last_date)::integer, count(*)
  from public.jobs j
  where j.last_date is not null
    and j.last_date < (timezone('Asia/Kolkata', now()))::date
  group by 1
  order by 1 desc;
$$;

revoke all on function public.admin_expired_years() from public, anon, authenticated;
grant execute on function public.admin_expired_years() to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- Deleting expired listings, with the guard in the database
-- ═══════════════════════════════════════════════════════════════════════════
-- The TypeScript action checks the reference counts before it calls this, and
-- that check is not enough on its own — it reads the counts, renders a page, and
-- acts on a form posted back some minutes later. Somebody can save one of those
-- listings in between, and the check would be deciding on a world that no longer
-- exists.
--
-- So the predicate that actually protects the row lives here, inside the same
-- statement as the delete. A job that acquired a save while the page was open
-- is skipped rather than deleted, and the caller is told how many it did.
--
-- Note this deletes rather than archives, and only ever rows nobody has touched.
-- The page defaults to archiving; this is the second button, for genuinely dead
-- weight.
create or replace function public.admin_delete_expired_jobs(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  if p_ids is null or array_length(p_ids, 1) is null then
    return 0;
  end if;

  -- A ceiling, because this is reachable from a form. Deleting 20,000 rows in
  -- one statement is not an operation anyone should be able to start by accident.
  if array_length(p_ids, 1) > 500 then
    raise exception 'admin_delete_expired_jobs: at most 500 ids per call';
  end if;

  delete from public.jobs j
  where j.id = any(p_ids)
    and j.last_date is not null
    and j.last_date < (timezone('Asia/Kolkata', now()))::date
    and not exists (select 1 from public.saved_jobs sj where sj.job_id = j.id)
    and not exists (select 1 from public.user_calendar_events ce where ce.job_id = j.id);

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.admin_delete_expired_jobs is
  'Deletes expired listings that no user has saved and no user has a reminder '
  'for. The reference check is inside the delete statement on purpose: the '
  'caller''s check is minutes stale by the time the form comes back, and '
  'saved_jobs / user_calendar_events cascade.';

revoke all on function public.admin_delete_expired_jobs(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_delete_expired_jobs(uuid[]) to service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- Feedback · resolving a submission
-- ═══════════════════════════════════════════════════════════════════════════
-- Reads need nothing new: `suggestions_owner_select` (0010) already lets an
-- admin select every row, and `grant select ... to authenticated` is in place,
-- so the inbox reads through the ordinary session client under RLS.
--
-- Writes have neither a grant nor a policy, which is the correct default for a
-- table anyone on the internet can insert into — but it means the status column
-- can only be moved by the secret key. That is what this is: one narrow
-- statement instead of a broad `grant update`, so the only thing an admin can
-- change about a submission is its status, and never its message.
create or replace function public.admin_set_feedback_status(p_id uuid, p_status text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found boolean;
begin
  -- Checked here as well as by the table's own constraint, so an invalid value
  -- is a clear error rather than a constraint violation surfacing as a 500.
  if p_status not in ('open', 'triaged', 'resolved', 'spam') then
    raise exception 'admin_set_feedback_status: unknown status %', p_status;
  end if;

  update public.suggestions_grievances
     set status = p_status
   where id = p_id;

  get diagnostics v_found = row_count;
  return v_found;
end;
$$;

revoke all on function public.admin_set_feedback_status(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_set_feedback_status(uuid, text) to service_role;


-- Counts for the inbox's filter chips, so each one says how much is behind it.
create or replace function public.admin_feedback_counts()
returns table (
  open_count      bigint,
  triaged_count   bigint,
  resolved_count  bigint,
  spam_count      bigint,
  open_grievances bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    count(*) filter (where status = 'open'),
    count(*) filter (where status = 'triaged'),
    count(*) filter (where status = 'resolved'),
    count(*) filter (where status = 'spam'),
    -- The one number worth acting on today: something is broken and nobody has
    -- looked at it. 0029 gave this its own partial index for the same reason.
    count(*) filter (where status = 'open' and kind = 'grievance')
  from public.suggestions_grievances;
$$;

revoke all on function public.admin_feedback_counts() from public, anon, authenticated;
grant execute on function public.admin_feedback_counts() to service_role;
