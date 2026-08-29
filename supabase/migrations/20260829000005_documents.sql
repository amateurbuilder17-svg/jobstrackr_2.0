-- ═══════════════════════════════════════════════════════════════════════════
-- 0030 · Module 25 · Document storage and OCR state
-- ═══════════════════════════════════════════════════════════════════════════
-- `documents` was created in 0008 with a `storage_path` column pointing at a
-- bucket that does not exist — nothing in this repo ever created one. This
-- creates it, with the policies, and adds the columns an OCR run needs to
-- record what happened.
--
-- What is being stored is somebody's Aadhaar card and their marksheets. The
-- policies below are the whole security of that, so they are written to be read.

-- ── The bucket ─────────────────────────────────────────────────────────────
-- Private. A public bucket serves every object to anyone who can guess a URL,
-- and these URLs contain a user id and a filename.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  -- 20 MB, matching the `documents_size_sane` check on the table. Two limits
  -- that disagree produce an upload the storage layer accepts and the row
  -- insert then rejects, leaving an orphaned object nobody can see or delete.
  20971520,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'
  ]
)
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ── Who may touch an object ────────────────────────────────────────────────
-- Every policy keys on the FIRST PATH SEGMENT being the caller's own user id:
--
--     <user-id>/<uuid>.jpg
--
-- so the path itself carries the ownership and there is no join to get wrong.
-- This is the same rule the old project enforced in application code, moved
-- into the database — the old one checked it inside the edge function, which
-- means it held for exactly as long as every future caller remembered to.
--
-- `storage.foldername(name)` splits the object key on '/', so element 1 is that
-- first segment.

drop policy if exists documents_owner_read on storage.objects;
create policy documents_owner_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists documents_owner_insert on storage.objects;
create policy documents_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists documents_owner_update on storage.objects;
create policy documents_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists documents_owner_delete on storage.objects;
create policy documents_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'documents'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );


-- ── OCR state on the row ───────────────────────────────────────────────────
alter table public.documents
  add column ocr_status   text not null default 'pending',
  add column ocr_result   jsonb,
  add column ocr_error    text,
  add column ocr_attempts smallint not null default 0,
  add column reviewed_at  timestamptz,

  add constraint documents_ocr_status_known check (
    ocr_status in ('pending', 'processing', 'done', 'failed', 'unsupported')
  ),
  add constraint documents_ocr_attempts_sane check (ocr_attempts between 0 and 5);

comment on column public.documents.ocr_result is
  'What the model read, as returned and validated — never written to the '
  'profile automatically. The review screen offers it field by field and the '
  'owner accepts each one.';
comment on column public.documents.reviewed_at is
  'Set when the owner has been through the extracted fields. Null means there '
  'is something waiting for them.';

-- A partial index on the queue, not the whole table: the only question anyone
-- asks of this column is "what is still waiting".
create index documents_pending_idx on public.documents (user_id, created_at)
  where ocr_status in ('pending', 'processing');


-- ── Rate limiting an OCR run ───────────────────────────────────────────────
-- The old function allowed 7 a day per user, enforced through a `check_user_
-- rate_limit` RPC. `claim_ai_quota` already does this job for exam status and
-- syllabus, so OCR joins it rather than growing a second mechanism.
alter table public.ai_usage
  drop constraint ai_usage_kind_known;

alter table public.ai_usage
  add constraint ai_usage_kind_known
    check (kind in ('exam_status', 'syllabus', 'ocr'));
