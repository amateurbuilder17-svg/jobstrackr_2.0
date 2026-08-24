-- ═══════════════════════════════════════════════════════════════════════════
-- 0002 · Shared types, helpers, and conventions
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Enums ──────────────────────────────────────────────────────────────────
-- Text columns with an application-side "allowed values" comment drift. An
-- enum makes the database reject the typo instead of storing it.

create type public.job_status as enum (
  'draft',      -- scraped, not yet reviewed
  'published',  -- live and visible
  'closed',     -- deadline passed
  'archived'    -- withdrawn or superseded
);

create type public.update_category as enum (
  'admit_card', 'result', 'answer_key', 'syllabus',
  'notification', 'exam_date', 'cutoff', 'news'
);

create type public.gender_eligibility as enum ('any', 'male', 'female');

-- Ordered on purpose: a job requiring level N is open to anyone at level >= N,
-- which makes eligibility an integer comparison instead of a text match.
-- Stored as smallint rather than an enum so that comparison is index-friendly.
create type public.qualification_level as enum (
  'class_10', 'class_12', 'iti', 'diploma',
  'bachelor', 'master', 'doctorate'
);

-- ── updated_at ─────────────────────────────────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.touch_updated_at is
  'BEFORE UPDATE trigger. Attach to every table carrying an updated_at column.';

-- ── Slug helper ────────────────────────────────────────────────────────────
-- Slugs are the SEO surface: ~5,200 job pages are indexed under the old URLs,
-- so generated slugs must match the old scheme exactly. Kept immutable so it
-- can be used in generated columns and indexes.
create or replace function public.slugify(input text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select trim(both '-' from
    regexp_replace(
      regexp_replace(lower(extensions.unaccent(input)), '[^a-z0-9]+', '-', 'g'),
      '-{2,}', '-', 'g'
    )
  );
$$;

-- ── Immutable array flattening ─────────────────────────────────────────────
-- `array_to_string` is marked STABLE, not IMMUTABLE, so it cannot appear in a
-- generated column — which is where tags need to be folded into a tsvector.
--
-- The STABLE marking is a consequence of the signature being `anyarray`: for an
-- arbitrary element type, the output function could in principle depend on
-- session settings (think timestamps and TimeZone). Pinned to `text[]`, no such
-- dependency exists — text has no session-sensitive output — so declaring this
-- wrapper IMMUTABLE is sound rather than a convenient fiction.
--
-- Do not widen this signature to anyarray. That would make the declaration
-- false, and the consequence is silently wrong index contents, which is close
-- to the worst class of bug there is.
create or replace function public.text_array_to_string(arr text[], sep text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select array_to_string(arr, sep);
$$;

comment on function public.text_array_to_string is
  'IMMUTABLE array_to_string, pinned to text[] so it is usable in generated '
  'columns and index expressions. See the inline note before widening it.';
