-- ═══════════════════════════════════════════════════════════════════════════
-- 0015 · Module 11 · Change detection
-- ═══════════════════════════════════════════════════════════════════════════
-- The gate is "a re-run over unchanged data writes zero rows", and `dedupe_key`
-- alone cannot deliver it. It identifies a listing, so an upsert on it is
-- correct — but an upsert still writes: Postgres updates the row, bumps
-- updated_at, fires the trigger and dirties the page, even when every value is
-- identical. Over 5,231 rows on a daily cron that is 5,231 pointless writes and
-- 5,231 cache invalidations a day.
--
-- So the worker needs to know, before writing, whether anything actually
-- changed. `content_hash` is that: a digest of exactly the fields ingestion
-- would write. Same hash, no write, no revalidation.
--
-- Deliberately not a generated column, unlike jobs.required_stream: this
-- summarises what the *source* said, not what these columns currently hold. A
-- generated hash would recompute from the stored row and could never detect
-- that the row and the source had diverged.

alter table public.jobs
  add column content_hash text;

alter table public.exam_updates
  add column content_hash text;

comment on column public.jobs.content_hash is
  'Digest of the source fields ingestion writes. The worker compares this '
  'before upserting so unchanged rows are skipped entirely — see Module 11. '
  'NULL means never ingested by the worker (e.g. seeded), which reads as '
  '"changed" and is the safe default.';

comment on column public.exam_updates.content_hash is
  'See jobs.content_hash.';

-- The worker fetches (dedupe_key, content_hash) for a batch of incoming keys.
-- Covering index, so that lookup never touches the heap.
create index jobs_dedupe_hash_idx
  on public.jobs (dedupe_key) include (content_hash)
  where dedupe_key is not null;

create index exam_updates_dedupe_hash_idx
  on public.exam_updates (dedupe_key) include (content_hash)
  where dedupe_key is not null;
