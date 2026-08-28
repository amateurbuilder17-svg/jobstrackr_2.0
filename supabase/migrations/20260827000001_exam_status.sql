-- ═══════════════════════════════════════════════════════════════════════════
-- 0023 · Module 19 · AI exam status
-- ═══════════════════════════════════════════════════════════════════════════
-- The old app's most-used feature on the tracker: "Refresh Status" asked Gemini
-- — with Google Search grounding — where an exam had got to, and rendered admit
-- card / exam date / result per phase.
--
-- It cached the answer on `exams.ai_cached_response`, which had three problems
-- worth not repeating:
--
--   1. A public content table gained a fat JSONB column written by end users
--      pressing a button. `exams` is 107 curated rows; it should not be a cache.
--   2. Only rows with an `exams` id could be cached at all. In this schema an
--      attempt may name a job or free text instead (`exam_attempts_has_subject`),
--      and those are exactly the attempts nobody had an answer for.
--   3. The cached JSON was whatever the model happened to emit that day, so
--      every reader carried fallbacks for four historical shapes. The reader in
--      the old app was 1,321 lines, most of it shape-sniffing.
--
-- So: a cache table of its own, keyed by *subject* rather than by exam, holding
-- one canonical normalised shape. One person refreshing SSC CGL answers it for
-- everyone tracking SSC CGL, which is the whole economy of the feature — the
-- model call is the expensive part and the answer is not personal.

create table public.exam_status_reports (
  -- 'exam:<uuid>' | 'job:<uuid>' | 'name:<slugified custom name>'. Computed by
  -- `subjectKeyFor` in the app, which is the only writer of this value.
  subject_key   text primary key,

  -- Both nullable, and at most one is set. They exist for the cascade and for
  -- the cron's "which subjects are worth refreshing" query, not as the key:
  -- a free-text attempt has neither and still gets a cached report.
  exam_id       uuid references public.exams (id) on delete cascade,
  job_id        uuid references public.jobs (id) on delete cascade,

  -- What was actually asked about, as shown to the reader. Kept denormalised
  -- because a `name:` subject has no row anywhere else to read it back from.
  subject_label text not null,

  -- The normalised report. Written only by the app, and only after it has been
  -- parsed into the canonical shape — see `parseStatusReport`. Readers do not
  -- shape-sniff.
  report        jsonb not null,

  -- The model's own confidence, 0–100. Drives two decisions: a low-confidence
  -- report goes stale in hours rather than a day, and never advances anyone's
  -- tracked status automatically.
  confidence    smallint,

  model         text not null,
  -- False when grounding was unavailable and the answer came from model memory
  -- alone. That is a materially weaker answer about this week's admit card, so
  -- the reader is told.
  grounded      boolean not null default false,
  sources       jsonb not null default '[]'::jsonb,

  refresh_count integer not null default 1,
  refreshed_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),

  constraint exam_status_reports_subject_shape
    check (subject_key ~ '^(exam:[0-9a-f-]{36}|job:[0-9a-f-]{36}|name:[a-z0-9-]{1,120})$'),
  constraint exam_status_reports_one_subject
    check (num_nonnulls(exam_id, job_id) <= 1),
  constraint exam_status_reports_confidence_range
    check (confidence is null or confidence between 0 and 100)
);

comment on table public.exam_status_reports is
  'Shared cache of AI exam-status answers, keyed by subject rather than by '
  'user. One refresh serves everyone tracking the same exam.';

comment on column public.exam_status_reports.report is
  'Canonical normalised shape only. The model emits loose JSON; the app '
  'normalises before writing so no reader has to sniff shapes.';

-- The cron's pick: oldest report first, among subjects somebody tracks.
create index exam_status_reports_stale_idx on public.exam_status_reports (refreshed_at);
create index exam_status_reports_exam_idx on public.exam_status_reports (exam_id)
  where exam_id is not null;


-- ── Per-user quota ─────────────────────────────────────────────────────────
-- A model call costs money and free-tier quota, and the button that triggers
-- one is on a page anybody can reach with an account. The in-process token
-- bucket that guards the other writes is per-instance and resets on a cold
-- start — fine for stopping a stuck retry loop, useless as a spend ceiling.
-- This one is in the database, where it is the same ceiling for every instance.

create table public.ai_usage (
  user_id uuid    not null references auth.users (id) on delete cascade,
  kind    text    not null,
  -- The India-time day, so the quota resets at IST midnight rather than at
  -- 05:30 local for a product whose entire audience is in one timezone.
  day     date    not null,
  used    integer not null default 0,
  last_at timestamptz not null default now(),

  primary key (user_id, kind, day),
  constraint ai_usage_kind_known check (kind in ('exam_status')),
  constraint ai_usage_used_sane check (used >= 0)
);

alter table public.exam_status_reports enable row level security;
alter table public.ai_usage enable row level security;

-- Reports are readable by any signed-in user: they are public facts about a
-- public exam, and the tracker is the only page that reads them. No write
-- policy at all — the app writes with the secret key, after it has verified the
-- caller owns the attempt and has quota left.
grant select on public.exam_status_reports to authenticated;

create policy exam_status_reports_read on public.exam_status_reports
  for select to authenticated using (true);

-- `ai_usage` gets no grant and no policy. It is written only by the function
-- below, which is SECURITY DEFINER; a user has no reason to read their own
-- counter directly, and every reason not to be able to write it.


-- ── Claiming quota ─────────────────────────────────────────────────────────
-- Atomic: the check and the increment are one statement, so two tabs pressing
-- Refresh at the same instant cannot both see "9 used" and both proceed.
--
-- Returns rather than raises, because being out of quota is an ordinary answer
-- the UI renders as a sentence — not an exception.
create or replace function public.claim_ai_quota(
  p_kind             text,
  p_daily_limit      integer,
  p_cooldown_seconds integer
)
returns table (allowed boolean, used integer, resets_at timestamptz, retry_after integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user     uuid := (select auth.uid());
  v_day      date := (timezone('Asia/Kolkata', now()))::date;
  v_resets   timestamptz;
  v_last     timestamptz;
  v_used     integer;
  v_wait     integer;
begin
  -- Midnight IST at the start of tomorrow, as an absolute instant.
  v_resets := timezone('Asia/Kolkata', (v_day + 1)::timestamp);

  if v_user is null then
    return query select false, 0, v_resets, 0;
    return;
  end if;

  if p_daily_limit < 1 then
    return query select false, 0, v_resets, 0;
    return;
  end if;

  -- Take the row (creating it at zero if today is this user's first call) and
  -- hold it for the rest of the transaction.
  insert into public.ai_usage (user_id, kind, day, used, last_at)
  values (v_user, p_kind, v_day, 0, now() - make_interval(secs => greatest(p_cooldown_seconds, 0) + 1))
  on conflict (user_id, kind, day) do update
    set used = public.ai_usage.used
  returning public.ai_usage.used, public.ai_usage.last_at into v_used, v_last;

  -- Cooldown first: a refused call must not consume quota, or a held-down
  -- button would burn a day's allowance without ever reaching the model.
  v_wait := greatest(0, ceil(extract(epoch from (v_last + make_interval(secs => greatest(p_cooldown_seconds, 0))) - now()))::integer);
  if v_wait > 0 then
    return query select false, v_used, v_resets, v_wait;
    return;
  end if;

  if v_used >= p_daily_limit then
    return query select false, v_used, v_resets,
      greatest(1, ceil(extract(epoch from v_resets - now()))::integer);
    return;
  end if;

  update public.ai_usage
     set used = public.ai_usage.used + 1, last_at = now()
   where public.ai_usage.user_id = v_user
     and public.ai_usage.kind = p_kind
     and public.ai_usage.day = v_day
  returning public.ai_usage.used into v_used;

  return query select true, v_used, v_resets, 0;
end;
$$;

comment on function public.claim_ai_quota is
  'Atomically claims one AI call for the current user. Returns allowed=false '
  'with retry_after rather than raising — being out of quota is a normal state.';

revoke all on function public.claim_ai_quota(text, integer, integer) from public;
grant execute on function public.claim_ai_quota(text, integer, integer) to authenticated;


-- ── What the nightly refresh should pick ───────────────────────────────────
-- The cron has one job: keep the most-tracked exams from going stale, within a
-- budget small enough to survive a free tier. Expressed here rather than in the
-- app because it aggregates `exam_attempts`, an RLS-protected table the app's
-- session client can only ever see one user's rows of — the same reasoning as
-- `popular_exams` in 0021.
create or replace function public.stale_status_subjects(
  p_limit     integer default 8,
  p_stale_after interval default interval '20 hours'
)
returns table (
  subject_key      text,
  exam_id          uuid,
  job_id           uuid,
  subject_label    text,
  organization     text,
  official_website text,
  trackers         bigint,
  refreshed_at     timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with subjects as (
    select
      case
        when a.exam_id is not null then 'exam:' || a.exam_id::text
        else 'job:' || a.job_id::text
      end                                     as subject_key,
      a.exam_id,
      a.job_id,
      coalesce(e.name, j.title)               as subject_label,
      o.name                                  as organization,
      coalesce(e.official_website, j.source_url) as official_website,
      count(*)                                as trackers
    from public.exam_attempts a
    left join public.exams         e on e.id = a.exam_id
    left join public.jobs          j on j.id = a.job_id
    left join public.organizations o on o.id = coalesce(e.organization_id, j.organization_id)
    -- Free-text subjects are deliberately excluded. There is no way to tell
    -- two people's spelling of the same exam apart, so refreshing them in
    -- bulk spends the budget on near-duplicates. They stay refreshable by
    -- hand, which is where a one-off subject belongs.
    --
    -- The parentheses matter: `and` binds tighter than `or`, so without them
    -- the status filter would apply only to the job branch.
    where (a.exam_id is not null or a.job_id is not null)
      -- Nothing is learned by re-asking about an attempt its owner has closed.
      and a.status not in ('passed', 'failed', 'withdrawn')
    group by 1, 2, 3, 4, 5, 6
  )
  select
    s.subject_key,
    s.exam_id,
    s.job_id,
    s.subject_label,
    s.organization,
    s.official_website,
    s.trackers,
    r.refreshed_at
  from subjects s
  left join public.exam_status_reports r on r.subject_key = s.subject_key
  where s.subject_label is not null
    and (r.refreshed_at is null or r.refreshed_at < now() - p_stale_after)
  -- Most-tracked first: the budget buys the most readers per call.
  order by s.trackers desc, r.refreshed_at asc nulls first
  limit greatest(p_limit, 0);
$$;

comment on function public.stale_status_subjects is
  'The nightly refresh queue: tracked subjects whose cached report is missing '
  'or stale, most-tracked first. Service role only.';

revoke all on function public.stale_status_subjects(integer, interval) from public;


-- ── Retention ──────────────────────────────────────────────────────────────
-- Both tables above are unbounded by construction, which is the leak 0009 was
-- written to stop happening again. Replaced rather than added to, so there is
-- still exactly one prune function and one place to read what it keeps.
create or replace function public.prune_operational_data()
returns table (table_name text, rows_deleted bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  n bigint;
begin
  delete from public.sync_runs where started_at < now() - interval '30 days';
  get diagnostics n = row_count;
  table_name := 'sync_runs'; rows_deleted := n; return next;

  delete from public.sync_dead_letter
   where resolved_at is not null and resolved_at < now() - interval '90 days';
  get diagnostics n = row_count;
  table_name := 'sync_dead_letter'; rows_deleted := n; return next;

  -- A quota counter is spent the moment its day ends. Kept a month for the
  -- one question worth asking of it: is the daily limit set anywhere near
  -- where real usage sits?
  delete from public.ai_usage where day < (timezone('Asia/Kolkata', now()))::date - 30;
  get diagnostics n = row_count;
  table_name := 'ai_usage'; rows_deleted := n; return next;

  -- Six months without a refresh means nobody has tracked this subject in six
  -- months. The report is worthless as an answer by then and is regenerated on
  -- demand if anyone asks again.
  delete from public.exam_status_reports where refreshed_at < now() - interval '180 days';
  get diagnostics n = row_count;
  table_name := 'exam_status_reports'; rows_deleted := n; return next;
end;
$$;

comment on function public.prune_operational_data is
  'Retention: 30 days of sync runs, 90 days of resolved dead-letter rows, '
  '30 days of AI quota counters, 180 days of unrefreshed status reports. '
  'Unresolved dead-letter rows are never pruned — they are the backlog.';
