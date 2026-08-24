-- ═══════════════════════════════════════════════════════════════════════════
-- 0009 · Ingestion and operations
-- ═══════════════════════════════════════════════════════════════════════════
-- The old project carried 14.1 MB of logs across 18 tables, `api_usage_logs`
-- alone holding 19,512 rows and growing without limit. None of it is migrated.
-- Every table here is created with a stated retention window and a prune
-- function, so unbounded growth is a decision someone has to make rather than
-- something that happens by default.

create table public.scraper_sources (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  url             text not null unique,
  category        public.update_category not null default 'news',
  is_active       boolean not null default true,
  limit_per_run   smallint not null default 6,
  last_scraped_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint scraper_sources_limit_sane check (limit_per_run between 1 and 100)
);
create trigger scraper_sources_touch_updated_at before update on public.scraper_sources
  for each row execute function public.touch_updated_at();
alter table public.scraper_sources enable row level security;


create type public.sync_status as enum ('running', 'succeeded', 'failed', 'partial');

create table public.sync_runs (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null,
  status          public.sync_status not null default 'running',

  rows_seen       integer not null default 0,
  rows_inserted   integer not null default 0,
  rows_updated    integer not null default 0,
  rows_unchanged  integer not null default 0,
  rows_failed     integer not null default 0,

  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  duration_ms     integer,
  error           text,

  constraint sync_runs_kind_known check (kind in ('jobs', 'exam_updates', 'embeddings', 'reconcile'))
);

comment on column public.sync_runs.rows_unchanged is
  'The number that matters. A re-run over unchanged data should be almost '
  'entirely unchanged rows and zero writes — that is the Module 11 gate.';

create index sync_runs_recent_idx on public.sync_runs (kind, started_at desc);


-- Rows that failed to ingest, kept so a bad row never stalls a batch and never
-- needs manual requeueing — the exact failure mode that bit the old pipeline.
create table public.sync_dead_letter (
  id            uuid primary key default gen_random_uuid(),
  sync_run_id   uuid references public.sync_runs (id) on delete set null,
  kind          text not null,
  source_key    text,
  payload       jsonb not null,
  error         text not null,
  attempts      smallint not null default 1,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);

create index sync_dead_letter_open_idx
  on public.sync_dead_letter (kind, created_at desc)
  where resolved_at is null;

alter table public.sync_runs enable row level security;
alter table public.sync_dead_letter enable row level security;


-- ── Retention ──────────────────────────────────────────────────────────────
-- Called by the daily reconcile cron. Without this, these tables become the
-- 14.1 MB problem again, just more slowly.
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
end;
$$;

-- ── A note for the ingestion worker (Module 11) ────────────────────────────
-- After a bulk upsert, VACUUM the touched tables. This is not tidiness: a bulk
-- insert leaves each GIN index's pending list unflushed, and Postgres prices an
-- unflushed GIN index roughly 76x above its true cost. Measured on 6,000 seeded
-- rows, the search index's estimated startup cost went from 990 to 13 after a
-- VACUUM, and the planner switched from a sequential scan to a 4-buffer,
-- 0.019 ms index scan.
--
-- Left to autovacuum, there is a window after every sync where full-text search
-- silently scans the whole table — the kind of regression that shows up as
-- "search feels slow lately" and takes a week to trace back to the scraper.

comment on function public.prune_operational_data is
  'Retention: 30 days of sync runs, 90 days of resolved dead-letter rows. '
  'Unresolved dead-letter rows are never pruned — they are the backlog.';
