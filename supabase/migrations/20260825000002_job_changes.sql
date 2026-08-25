-- ═══════════════════════════════════════════════════════════════════════════
-- 0017 · What changed on a listing
-- ═══════════════════════════════════════════════════════════════════════════
-- Government notifications get corrected. Closing dates are extended, vacancy
-- counts revised, fees changed, exams postponed. The aspirant's daily question
-- is not "is there a new job" — it is "did something change on a job I am
-- counting on?" No aggregator in this category answers it, and the departments
-- themselves simply replace the PDF.
--
-- The ingest worker has always known. It hashes what it is about to write,
-- compares against `content_hash`, and skips the row when they match — so it
-- can already tell a changed row from an unchanged one. What it could not tell
-- was *what* changed, because it only ever read the hash back, never the old
-- values. Widening that one existing SELECT is the whole cost of this feature.
--
-- Nothing here is written on a page view, and nothing here is read from the
-- database on a page view either: the rows are rendered into the statically
-- generated job page when its tag is revalidated.

create table public.job_changes (
  id          bigint generated always as identity primary key,
  job_id      uuid not null references public.jobs (id) on delete cascade,

  -- A logical field, not a column name: `vacancies` covers both the typed count
  -- and the scraped display string, which are two spellings of one fact and
  -- must not produce two rows saying the same thing.
  field       text not null,

  -- Values are text because these are for reading, not for arithmetic, and the
  -- watched set spans dates, integers and free text. A typed column per field
  -- would be a wide sparse table that has to be altered every time the watch
  -- list changes.
  old_value   text,
  new_value   text,

  changed_at  timestamptz not null default now(),
  sync_run_id uuid references public.sync_runs (id) on delete set null,

  constraint job_changes_field_known check (
    field in (
      'last_date', 'application_start_date', 'vacancies', 'application_fee', 'status'
    )
  ),
  -- A "change" where nothing changed is a bug in the differ, not a record.
  constraint job_changes_actually_changed check (old_value is distinct from new_value)
);

comment on table public.job_changes is
  'One row per watched field that changed on a job. Written only by ingestion, '
  'rendered into the static job page. The diff already existed; this persists it.';
comment on column public.job_changes.field is
  'Logical field, not column name. "vacancies" covers both vacancies and '
  'vacancies_display, which are two spellings of the same fact.';

-- The detail page asks for one job's recent changes, newest first. Covering the
-- ordering means that read never sorts.
create index job_changes_job_idx
  on public.job_changes (job_id, changed_at desc);

-- "What changed across everything, recently" — the Today feed's band, and the
-- admin view of a run's effects.
create index job_changes_recent_idx
  on public.job_changes (changed_at desc);

alter table public.job_changes enable row level security;

-- Readable wherever its job is readable, and by exactly the same rule — a
-- change to a draft listing must not leak the draft's dates.
create policy job_changes_public_read on public.job_changes
  for select to anon, authenticated using (
    exists (
      select 1 from public.jobs j
       where j.id = job_id and j.status in ('published', 'closed')
    )
  );

-- ── Retention ──────────────────────────────────────────────────────────────
-- Extends the existing prune rather than adding a second one, so there stays a
-- single place that answers "what grows, and for how long".
--
-- 180 days: long enough that a recruitment cycle's full history is intact while
-- anyone is still applying, short enough that this cannot become the 14.1 MB
-- problem the ops module exists to prevent.
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

  delete from public.job_changes where changed_at < now() - interval '180 days';
  get diagnostics n = row_count;
  table_name := 'job_changes'; rows_deleted := n; return next;
end;
$$;
