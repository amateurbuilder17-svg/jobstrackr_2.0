-- ═══════════════════════════════════════════════════════════════════════════
-- 0036 · The SEO worker
-- ═══════════════════════════════════════════════════════════════════════════
-- Publishing a job page and waiting for a crawler to notice is the slow path,
-- and for this audience it is the wrong one: a notification is worth reading
-- for the two weeks its window is open, and Googlebot's own schedule for a
-- small site is measured in days. Push indexing closes that gap — the site
-- tells the engines a URL changed, in the same minute ingestion writes it.
--
-- ── Why a watermark and not a queue ────────────────────────────────────────
-- The obvious design is a `seo_ping_queue` table with a row per URL and a
-- trigger on `jobs`. It was rejected for the reason every table here carries a
-- retention note: a queue is unbounded storage, against a 500 MB ceiling, that
-- must be pruned correctly forever or it becomes the thing that fills the disk.
--
-- A watermark is one row per target. "Everything published since this
-- timestamp" is derivable from `jobs.updated_at`, which already exists, is
-- already indexed, and is already only bumped when a row genuinely changed
-- (`content_hash`, migration 0015, is what makes that true — an unchanged
-- re-ingest does not touch it, so it does not re-ping either).
--
-- It also catches writes the ingest path knows nothing about: an admin edit, a
-- `merge_duplicate_jobs` run, a manual status flip. Anything that moves
-- `updated_at` is a thing a crawler should be told about, and the watermark
-- sees all of them without a single line of application code at the write site.
--
-- ── What each target is allowed to receive ─────────────────────────────────
-- IndexNow takes any URL on the host. It is what Bing, Yandex, Seznam and Naver
-- read, and Bing's index is what ChatGPT's search feature answers from — so
-- this is the row that buys AI-assistant visibility, not a separate mechanism.
--
-- Google's Indexing API is narrower and the narrowness is the point: Google
-- sanctions it for pages carrying `JobPosting` or `BroadcastEvent` structured
-- data and nothing else. `/jobs/*` qualifies and is submitted; `/updates/*`
-- does not and is deliberately never sent, because a site that abuses the
-- endpoint for general pages gets its access withdrawn. Update pages reach
-- Google through the sitemap, which is what the sitemap is for.

create table public.seo_ping_state (
  target              text primary key,
  -- The high-water mark: every published row whose `updated_at` is at or
  -- before this has already been offered to this target. Starts at the epoch
  -- so the first run submits the existing corpus, paced by the batch cap.
  last_url_updated_at timestamptz not null default '1970-01-01T00:00:00Z',
  last_run_at         timestamptz,
  last_run_urls       integer not null default 0,
  last_error          text,

  -- Google allows 200 URL notifications a day per project and answers 429
  -- past that. Counted here rather than inferred from the log, because the
  -- log is pruned and a quota is not a historical question.
  quota_day           date,
  quota_used          integer not null default 0,

  updated_at          timestamptz not null default now(),

  constraint seo_ping_state_target_known check (target in ('indexnow', 'google')),
  constraint seo_ping_state_quota_sane check (quota_used >= 0)
);
create trigger seo_ping_state_touch_updated_at before update on public.seo_ping_state
  for each row execute function public.touch_updated_at();
alter table public.seo_ping_state enable row level security;

comment on table public.seo_ping_state is
  'One row per push-indexing target. `last_url_updated_at` is the watermark '
  'over jobs.updated_at / exam_updates.updated_at; nothing at or below it is '
  'resubmitted.';

-- Seeded here rather than upserted by the worker: the two targets are a fixed
-- set, and a worker that can create rows in its own control table is a worker
-- that can quietly invent a third target with a zero watermark and resubmit
-- the whole corpus.
insert into public.seo_ping_state (target) values ('indexnow'), ('google');


create table public.seo_ping_log (
  id          bigint generated always as identity primary key,
  target      text not null,
  url         text not null,
  ok          boolean not null,
  http_status integer,
  error       text,
  pinged_at   timestamptz not null default now()
);
create index seo_ping_log_recent_idx on public.seo_ping_log (pinged_at desc);
-- Partial, because the only query anyone runs against this table is "what is
-- failing" — a full index over the successes would be paid for on every write
-- to answer a question nobody asks.
create index seo_ping_log_failures_idx on public.seo_ping_log (pinged_at desc)
  where not ok;
alter table public.seo_ping_log enable row level security;

comment on table public.seo_ping_log is
  'Retention: 14 days, pruned by prune_operational_data(). Evidence for "is '
  'push indexing actually working", not an audit trail.';


-- ── The watermark query's index ────────────────────────────────────────────
-- "published rows whose updated_at is after X, oldest first, capped" is the
-- only query the worker makes against the content tables, and without these it
-- is a sequential scan over the whole corpus on every ingest — the exact shape
-- of cost this architecture exists to avoid. Partial, because an unpublished
-- row is never submitted and has no business occupying the index.
create index jobs_seo_watermark_idx
  on public.jobs (updated_at)
  where status = 'published';

create index exam_updates_seo_watermark_idx
  on public.exam_updates (updated_at)
  where is_published;


-- ── Reads ──────────────────────────────────────────────────────────────────
-- Admin-only, through the same shape as sync_runs (0010): granted to
-- `authenticated`, gated by `has_role('admin')`. The worker itself uses the
-- secret key and bypasses all of this.
grant select on public.seo_ping_state, public.seo_ping_log to authenticated;

create policy seo_ping_state_admin_read on public.seo_ping_state
  for select to authenticated using (public.has_role('admin'));
create policy seo_ping_log_admin_read on public.seo_ping_log
  for select to authenticated using (public.has_role('admin'));


-- ── Retention ──────────────────────────────────────────────────────────────
-- Folded into the existing daily prune rather than given a cron of its own:
-- Vercel Hobby allows two crons and both are spoken for, and a log that is
-- pruned a few hours late is not a problem.
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

  -- 14 days, shorter than the 30 the sync tables get. A ping either landed
  -- within the hour or it did not; a fortnight-old submission receipt informs
  -- no decision anyone will make.
  delete from public.seo_ping_log where pinged_at < now() - interval '14 days';
  get diagnostics n = row_count;
  table_name := 'seo_ping_log'; rows_deleted := n; return next;
end;
$$;

comment on function public.prune_operational_data is
  'Retention: 30 days of sync runs, 90 days of resolved dead-letter rows, '
  '14 days of SEO ping receipts. Unresolved dead-letter rows are never '
  'pruned — they are the backlog.';
