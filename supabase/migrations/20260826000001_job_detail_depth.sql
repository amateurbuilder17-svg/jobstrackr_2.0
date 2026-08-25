-- ═══════════════════════════════════════════════════════════════════════════
-- 0019 · Module 13 · Content depth
-- ═══════════════════════════════════════════════════════════════════════════
-- Two problems, one migration, because they have the same cause: a column that
-- something has to remember to write, and nothing did.
--
--   1. `min_qualification_level` is a hard filter in `match_jobs` (0011, the
--      `and j.min_qualification_level is not null` predicate). It is a plain
--      column, and the only writer that could fill it — the ingestion worker —
--      never has. So the predicate reads `null is not null` on every row and
--      the For You feed returns nothing for everybody, no matter how complete
--      their profile is. The page's "nothing matches you today" empty state has
--      been a lie since the day it shipped.
--
--   2. `job_details` has nowhere to put the two free-text blocks the source
--      notifications actually carry — the pay-scale paragraph and the
--      age-relaxation paragraph. Both were on the old detail page and both are
--      the answer to a question the typed columns cannot express.
--
-- 0011 already solved (1) for the *other* half of the qualification pair and
-- wrote down why: `required_stream` is a generated column precisely so that no
-- insert path can forget it. This applies the same treatment to the level.


-- ── Reading a qualification level out of free text ─────────────────────────
-- The sibling of `stream_of`. Same contract, and the same discipline: it
-- returns NULL for anything it does not positively recognise, and every caller
-- treats NULL as "do not match".
--
-- When several levels appear it returns the **lowest**, and the reason is the
-- column's own name. `min_qualification_level` is a floor, and `match_jobs`
-- compares it with `>=`; a parser that returned the highest level named would
-- make the column mean something other than what every reader of that
-- comparison assumes.
--
-- It is also the commoner wording by a distance. "Diploma or B.E./B.Tech in
-- Civil Engineering" is how half the engineering notifications in the country
-- are written, and it genuinely admits both — taking the ceiling would hide
-- every one of those jobs from the diploma holders they are aimed at, which is
-- a systematic exclusion rather than an occasional miss.
--
-- The cost is the other wording: "Bachelor's degree; diploma holders with three
-- years' experience" reads as a diploma job to this function. That candidate is
-- over-included, and the module's rule is precision over recall, so it is worth
-- being explicit about why this is the acceptable side of it: the stream filter
-- still applies, `experience_years_min` exists for exactly that conditional,
-- and the failure mode is a listing whose own eligibility text — printed in
-- full on the job page since Module 14 — says what else is required.
create or replace function public.level_of(subject text)
returns public.qualification_level
language sql
immutable
strict
set search_path = ''
as $$
  select level from (
    values
      ('doctorate'::public.qualification_level,
       subject ~* '\m(ph\.?\s?d|doctorate|doctoral)\M'),

      ('master'::public.qualification_level,
       subject ~* '\m(master''?s?|post[\s-]?grad\w*|pg\s+degree|m\.\s?tech|mtech|m\.\s?sc|msc|m\.\s?com|mcom|m\.?\s?c\.?\s?a|mca|m\.?\s?b\.?\s?a|mba|m\.\s?ed|m\.\s?pharm|m\.\s?e\.|m\.\s?a\.)\M'
       or subject ~ '\m(ME|MA|MTech|MSc|MCom|MCA|MBA)\M'),

      ('bachelor'::public.qualification_level,
       subject ~* '\m(bachelor''?s?|graduat\w+|degree|b\.\s?tech|btech|b\.\s?sc|bsc|b\.\s?com|bcom|b\.?\s?c\.?\s?a|bca|b\.?\s?b\.?\s?a|bba|b\.\s?ed|b\.\s?pharm|ll\.?\s?b|mbbs|b\.?\s?d\.?\s?s|bds|b\.\s?e\.|b\.\s?a\.)\M'
       or subject ~ '\m(BE|BA|BTech|BSc|BCom|BCA|BBA)\M'),

      ('diploma'::public.qualification_level,
       subject ~* '\m(diploma|polytechnic)\M'),

      ('iti'::public.qualification_level,
       subject ~* '\m(i\.?\s?t\.?\s?i|ncvt|scvt|trade\s+certificate|craftsman)\M'),

      ('class_12'::public.qualification_level,
       subject ~* '(\m(12th|xii|intermediate|higher\s+secondary|senior\s+secondary|h\.?\s?s\.?\s?c)\M|\mclass\s*12\M|\+\s?2\M)'),

      ('class_10'::public.qualification_level,
       subject ~* '(\m(10th|matric\w*|sslc|secondary\s+school|high\s+school)\M|\mclass\s*10\M)')
  ) as candidates(level, matched)
  where matched
  -- Enum values are ordered as declared in 0002, so `asc` takes the lowest
  -- level named anywhere in the text — the floor, which is what the column is.
  order by level asc
  limit 1;
$$;

-- ── Why the two-letter forms need dots or capitals ─────────────────────────
-- The first version matched `b\.?\s?e\.?` case-insensitively, so every optional
-- character was optional at once and the pattern reduced to the bare string
-- "be". "Candidates should be hardworking" was read as requiring a B.E., and
-- "ma", "me" and "ba" did the same thing. The abbreviations now need either
-- their dots ("B.E.") or their capitals ("BE"), which is how a notification
-- actually writes them and is not how prose writes an auxiliary verb.

comment on function public.level_of is
  'Maps a job''s qualification line to the level it requires. Returns NULL when '
  'the wording is not recognised, and callers must treat NULL as a non-match. '
  'Where several levels appear it returns the lowest: the column is a floor '
  'compared with >=, and "Diploma or B.E." genuinely admits both.';


-- ── The column, regenerated ────────────────────────────────────────────────
-- A plain column cannot be converted to a generated one in place, so this is a
-- drop and re-add. Nothing is lost: every row's value is NULL today, which is
-- the bug being fixed.
--
-- The index that carries the column is dropped explicitly rather than being
-- taken out by the cascade, so that what is rebuilt afterwards is visible here
-- and cannot silently fail to come back. 0012 consolidated the two eligibility
-- indexes into one; this recreates that one, not the pair it replaced.
drop index if exists public.jobs_eligibility_idx;
drop index if exists public.jobs_match_idx;

alter table public.jobs drop column min_qualification_level;

alter table public.jobs
  add column min_qualification_level public.qualification_level
  generated always as (public.level_of(qualification_summary)) stored;

comment on column public.jobs.min_qualification_level is
  'The level the notification requires, derived from qualification_summary. '
  'Generated rather than written, for the reason recorded on required_stream '
  'in 0011: a value an ingest path has to remember to write is a value that is '
  'eventually NULL for a month before anyone notices.';

create index jobs_eligibility_idx
  on public.jobs (status, min_qualification_level, age_min, age_max, required_stream)
  where status = 'published';

comment on index public.jobs_eligibility_idx is
  'Serves both the Module 1 eligibility prefilter and Module 8 matching. '
  'required_stream is last so the original (status, level, age_min, age_max) '
  'lookup remains a prefix scan.';


-- ── The two prose blocks ───────────────────────────────────────────────────
-- Free text, not parsed. `salary_min`/`salary_max` carry the figures; this
-- carries the paragraph that says "Level 7 of the 7th CPC pay matrix, plus DA
-- and HRA as admissible", which no pair of integers can express.
--
-- `age_limit_text` matters more than it looks: the typed age window is the
-- unrelaxed one, and `match_jobs` says so explicitly. The relaxations — OBC +3,
-- SC/ST +5, and the per-notification exceptions — live in this paragraph, and
-- printing it is how someone eligible only through relaxation finds that out.
alter table public.job_details
  add column salary_text    text,
  add column age_limit_text text;

comment on column public.job_details.age_limit_text is
  'The notification''s own wording on age, including relaxations. The typed '
  'age_min/age_max on jobs are the unrelaxed window; matching never applies a '
  'relaxation, so this text is the only place a candidate can read one.';


-- ── Highest-vacancy shelf (Module 16) ──────────────────────────────────────
-- Ordered descending with the count NOT NULL, so the planner walks the index
-- and stops at the limit instead of sorting every published row.
create index jobs_vacancies_idx
  on public.jobs (vacancies desc nulls last, id desc)
  where status = 'published' and vacancies is not null;
