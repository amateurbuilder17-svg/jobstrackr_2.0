-- ═══════════════════════════════════════════════════════════════════════════
-- 0020 · Module 14 · Tracking a job
-- ═══════════════════════════════════════════════════════════════════════════
-- "Track this exam" from a job page was the old app's second-most-used control
-- and there is nowhere for it to write. `exam_attempts` links to `exams`, and
-- `exams` has no relationship to `jobs` at all.
--
-- The old app solved that by creating an `exams` row for every job somebody
-- tracked — a public content table, written by any signed-in user, one row per
-- notification. With 5,800 published jobs that is a content table with 5,800
-- rows of user-generated near-duplicates in it, and a curated exam list that
-- stops being curated.
--
-- So the attempt points at the job directly. It is also the truer model: what
-- someone tracks from a job page is *that recruitment*, with its own dates and
-- its own deadline, not the exam family it belongs to.

alter table public.exam_attempts
  add column job_id uuid references public.jobs (id) on delete set null;

comment on column public.exam_attempts.job_id is
  'The notification this attempt was started from, when it began as "track" on '
  'a job page. Null for an attempt added by hand from the tracker.';

-- A job is now a subject in its own right. Without this, tracking a job would
-- still have to write the title into `custom_name` to satisfy the constraint —
-- denormalising the one field most likely to be corrected upstream.
alter table public.exam_attempts drop constraint exam_attempts_has_subject;

alter table public.exam_attempts add constraint exam_attempts_has_subject check (
  exam_id is not null
  or job_id is not null
  or nullif(btrim(coalesce(custom_name, '')), '') is not null
);

-- One attempt per person per job. Partial, because `job_id` is null for every
-- hand-added attempt and a plain unique index would allow exactly one of those
-- per user.
--
-- The insert path treats a violation of this as success rather than as an
-- error: pressing Track twice means the same thing as pressing it once.
create unique index exam_attempts_user_job_idx
  on public.exam_attempts (user_id, job_id)
  where job_id is not null;

-- The tracker page joins to the job for its title and deadline, and the job
-- page asks "does this person already track this?" — both from the user's own
-- rows, so the index is on the owner first.
create index exam_attempts_owner_job_idx
  on public.exam_attempts (user_id, job_id)
  where job_id is not null;
