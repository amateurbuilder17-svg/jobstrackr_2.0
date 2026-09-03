-- One-time data fix, not a schema migration — nothing here is repeatable
-- infrastructure, so it lives in scripts/ rather than supabase/migrations/.
--
-- ── Why exam_updates duplicated ──────────────────────────────────────────────
-- 5,374 rows were imported from the old project by backfill-from-old-project.mjs
-- without a `dedupe_key` (recover-update-links.mjs documents the same 5,374
-- figure for a different symptom — missing links — which is how this was
-- found: both scripts hit the same hole from different angles).
--
-- `ingestExamUpdates` matches existing rows with
-- `.in("dedupe_key", candidateKeys)`, and NULL never satisfies an IN list. So
-- every time the scraper re-touched one of these 5,374 rows, the lookup found
-- nothing and inserted a fresh duplicate instead of updating — the same title,
-- the same source_url, a second id. As of 2026-09-02 this had produced 5,278
-- duplicate rows, still growing on every sync.
--
-- ── What this does ────────────────────────────────────────────────────────
-- 1. Groups rows by (source_url, title) — the exact identity ingestExamUpdates
--    uses to compute dedupe_key — and keeps one per group: whichever already
--    has a dedupe_key (the row the current pipeline can find), or the newest
--    if more than one does.
-- 2. Reassigns saved_exam_updates before deleting the loser, so a user's saved
--    update points at the survivor instead of disappearing.
-- 3. Backfills dedupe_key on every row that still lacks one, using the exact
--    formula toUpdatePayload computes (src/lib/sync/updates.ts): first 32 hex
--    characters of sha256(source_url || "\n" || title). This is the actual
--    fix — it closes the gap that let the duplication happen in the first
--    place, so this script never needs to run again.
--
-- Run inside a transaction; SELECT the counts before COMMIT if you want to
-- eyeball them first.

begin;

create extension if not exists pgcrypto with schema extensions;

create temporary table _update_merge_map on commit drop as
with ranked as (
  select
    id,
    first_value(id) over (
      partition by lower(btrim(source_url)), lower(btrim(title))
      order by
        (dedupe_key is not null) desc,
        created_at desc,
        id
    ) as canonical_id,
    count(*) over (
      partition by lower(btrim(source_url)), lower(btrim(title))
    ) as grp_size
  from public.exam_updates
  where source_url is not null and title is not null
)
select id as loser_id, canonical_id
from ranked
where grp_size > 1 and id <> canonical_id;

select count(*) as rows_to_merge from _update_merge_map;

update public.saved_exam_updates seu
set exam_update_id = m.canonical_id
from _update_merge_map m
where seu.exam_update_id = m.loser_id
  and not exists (
    select 1 from public.saved_exam_updates seu2
    where seu2.user_id = seu.user_id and seu2.exam_update_id = m.canonical_id
  );
-- Any leftover saved_exam_updates row (the user already saved the canonical
-- too) is removed by ON DELETE CASCADE when the loser row goes below.

delete from public.exam_updates eu
using _update_merge_map m
where eu.id = m.loser_id;

update public.exam_updates
set dedupe_key = substr(
  encode(extensions.digest(source_url || chr(10) || title, 'sha256'), 'hex'),
  1, 32
)
where dedupe_key is null
  and source_url is not null
  and title is not null;

select count(*) as still_null_after_backfill
from public.exam_updates
where dedupe_key is null;

commit;
