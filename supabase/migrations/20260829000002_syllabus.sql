-- ═══════════════════════════════════════════════════════════════════════════
-- 0027 · Module 26 · Syllabus finder
-- ═══════════════════════════════════════════════════════════════════════════
-- A grounded model call takes 25-35 seconds and spends a key from a pool with
-- a daily cap. A syllabus changes when a conducting body revises it, which is
-- roughly never. So the cache is not an optimisation here; it is the feature.
-- Without it, ten people asking about SSC CGL on results day is ten identical
-- 30-second calls and a tenth of the day's quota, to produce the same page.
--
-- Keyed on `exam_key` -- the search string with its year, punctuation and
-- filler words removed (see lib/syllabus/key.ts). "SSC CGL 2025", "ssc-cgl"
-- and "syllabus for SSC CGL exam" are one row, not four.

create table public.syllabus_cache (
  -- The URL segment. Derived from the same words as the key, so a page cannot
  -- exist at an address that would not find it again.
  slug          text primary key,
  exam_key      text not null unique,

  -- The name as the model reported it, which is the official one and usually
  -- longer than what was typed: "SSC Combined Graduate Level Examination".
  exam_name     text not null,
  year          smallint,

  -- The parsed, validated syllabus -- never the raw model response. Whatever
  -- is written here has already been through the Zod schema, so a page reading
  -- it cannot be surprised by a shape that was never checked.
  data          jsonb not null,

  sources       text[] not null default '{}',
  confidence    real,

  -- False when the pool was rate-limited and the answer came back ungrounded.
  -- Carried to the page, which labels it, because an ungrounded syllabus is a
  -- recollection rather than a reading.
  grounded      boolean not null default true,
  model         text,

  fetched_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '30 days'),

  constraint syllabus_confidence_sane check (confidence is null or confidence between 0 and 1),
  constraint syllabus_year_sane check (year is null or year between 2000 and 2100)
);

comment on table public.syllabus_cache is
  'One row per exam, keyed on a normalised name. Rows are written only by the '
  'server with the secret key, after the model answer has passed validation.';

-- Expiry is checked on read, so the index carries it.
create index syllabus_cache_expiry_idx on public.syllabus_cache (expires_at);

alter table public.syllabus_cache enable row level security;

-- Readable by anyone, including signed-out visitors: a syllabus is a public
-- fact about a public exam, and making people sign in to read one would be
-- gatekeeping something the conducting body publishes for free.
--
-- Expired rows are invisible rather than deleted. A stale syllabus is worse
-- than none -- it is confidently wrong about what someone is about to study --
-- and the predicate means an expired row simply misses and is refetched, with
-- no cron needed to sweep the table.
grant select on public.syllabus_cache to anon, authenticated;

create policy syllabus_cache_read on public.syllabus_cache
  for select to anon, authenticated
  using (expires_at > now());

-- No insert, update or delete policy at all, deliberately. Writes go through
-- the server with the secret key, after validation. A client-writable cache is
-- a client-writable syllabus: anyone could put anything on a page that is
-- served, uncontested, to everyone who searches that exam for the next month.


-- ── Let the quota counter know about this kind ─────────────────────────────
-- `claim_ai_quota` is generic over `kind`, but `ai_usage` constrains the column
-- to the kinds that existed when it was written. Without this line every
-- syllabus search fails on a check violation -- after the model call, which is
-- the expensive half.
alter table public.ai_usage
  drop constraint ai_usage_kind_known;

alter table public.ai_usage
  add constraint ai_usage_kind_known check (kind in ('exam_status', 'syllabus'));
