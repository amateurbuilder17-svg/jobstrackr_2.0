-- ═══════════════════════════════════════════════════════════════════════════
-- 0006 · Exam updates — the largest table in the old project
-- ═══════════════════════════════════════════════════════════════════════════
-- 5,336 rows at 7.6 kB each: 39 MB, more than `jobs`. The weight is in five
-- JSONB columns (sections, overview, download_links, related_articles,
-- important_dates), every one of them detail-page-only. Same hot/cold split as
-- jobs, for the same reason.
--
-- One inherited bug is fixed here at the schema level. In the old project only
-- 3 of 3,373 rows had `job_id` populated, so every job page fell back to a
-- title-similarity scan — roughly 44 kB of wasted read per view. Here the link
-- is a real foreign key, resolved once at ingest, and `job_link_state` records
-- *why* a row has no link so an unresolved one is visible rather than silent.

create type public.job_link_state as enum (
  'unresolved',   -- not yet attempted
  'linked',       -- job_id is set
  'no_match',     -- searched, genuinely nothing to link to
  'ambiguous'     -- several candidates; needs a human
);

create table public.exam_updates (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  title             text not null,

  category          public.update_category not null default 'news',
  exam_id           uuid references public.exams (id) on delete set null,
  organization_id   uuid references public.organizations (id) on delete set null,

  -- The link the old schema never populated.
  job_id            uuid references public.jobs (id) on delete set null,
  job_link_state    public.job_link_state not null default 'unresolved',

  summary           text,
  tags              text[] not null default '{}',

  published_date    date,
  published_at      timestamptz,
  scraped_at        timestamptz not null default now(),

  source_url        text not null,
  dedupe_key        text unique,

  is_published      boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  search_vector tsvector generated always as (
    setweight(to_tsvector('public.jt_search', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('public.jt_search', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('public.jt_search', public.text_array_to_string(tags, ' ')), 'C')
  ) stored,

  constraint exam_updates_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint exam_updates_title_not_blank check (length(btrim(title)) > 0),
  -- Keeps state and data honest: 'linked' requires a job, and everything else
  -- forbids one. Without this the column drifts back to being decorative.
  constraint exam_updates_link_state_consistent check (
    (job_link_state = 'linked' and job_id is not null) or
    (job_link_state <> 'linked' and job_id is null)
  )
);

comment on column public.exam_updates.job_link_state is
  'Why this row does or does not link to a job. The old schema had job_id '
  'nullable with no state, so 3 rows in 3,373 were linked and nobody noticed — '
  'every job page paid a title-similarity fallback scan instead.';

create index exam_updates_feed_idx
  on public.exam_updates (is_published, published_at desc, id desc);
create index exam_updates_search_idx on public.exam_updates using gin (search_vector);
create index exam_updates_tags_idx   on public.exam_updates using gin (tags);
create index exam_updates_category_idx
  on public.exam_updates (category, published_at desc) where is_published;
create index exam_updates_exam_idx on public.exam_updates (exam_id, published_at desc);
create index exam_updates_job_idx  on public.exam_updates (job_id) where job_id is not null;
-- Lets the admin queue "everything still needing a link" without a scan.
create index exam_updates_unlinked_idx
  on public.exam_updates (job_link_state, scraped_at desc)
  where job_link_state in ('unresolved', 'ambiguous');

create trigger exam_updates_touch_updated_at
  before update on public.exam_updates
  for each row execute function public.touch_updated_at();

alter table public.exam_updates enable row level security;


-- ── Cold half ──────────────────────────────────────────────────────────────

create table public.exam_update_details (
  exam_update_id    uuid primary key references public.exam_updates (id) on delete cascade,

  body              text,
  sections          jsonb,
  overview          jsonb,
  important_dates   jsonb,
  download_links    jsonb,
  related_articles  jsonb,
  raw               jsonb,

  updated_at        timestamptz not null default now()
);

comment on table public.exam_update_details is
  'Cold half: the five JSONB columns that made the old exam_updates table 39 MB. '
  'Detail page and admin editor only.';

create trigger exam_update_details_touch_updated_at
  before update on public.exam_update_details
  for each row execute function public.touch_updated_at();

alter table public.exam_update_details enable row level security;
