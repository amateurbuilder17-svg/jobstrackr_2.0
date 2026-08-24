-- ═══════════════════════════════════════════════════════════════════════════
-- 0004 · Jobs — the hot/cold split
-- ═══════════════════════════════════════════════════════════════════════════
-- The old `jobs` table averaged 6.0 kB per row across 5,861 rows, and the app
-- shipped all of it to every visitor. Almost all of that weight is prose and
-- JSONB that only the detail page renders.
--
-- Postgres already keeps oversized values out of the main heap via TOAST, so a
-- narrow SELECT was never obliged to read them — the old app simply never wrote
-- a narrow SELECT. Splitting the table makes that mistake unavailable rather
-- than merely discouraged: a query against `jobs` *cannot* pull the detail
-- payload, because it is not there to pull.
--
-- Target: a job card row is ~400 bytes. Twenty of them fit in one 8 kB page.

create table public.jobs (
  id                      uuid primary key default gen_random_uuid(),

  -- ── Identity ────────────────────────────────────────────────────────────
  -- The slug is the SEO surface. ~5,200 of these are indexed under the old
  -- URLs, so migration reproduces them verbatim; it is never regenerated for
  -- an existing row. Renaming a slug means shipping a 301, not an UPDATE.
  slug                    text not null unique,
  title                   text not null,
  organization_id         uuid references public.organizations (id) on delete restrict,

  -- ── Card fields ─────────────────────────────────────────────────────────
  location                text,
  state                   text,
  vacancies               integer,
  vacancies_display       text,
  qualification_summary   text,

  application_start_date  date,
  last_date               date,
  last_date_display       text,

  salary_min              integer,
  salary_max              integer,
  salary_display          text,
  application_fee         integer,

  -- ── Typed eligibility ───────────────────────────────────────────────────
  -- These exist so Module 8 can filter in SQL instead of parsing prose in the
  -- browser. The old matcher was 65 kB of JavaScript that needed every row
  -- present to answer "am I eligible"; these columns turn the same question
  -- into an indexed WHERE clause. Raw text stays in job_details.
  min_qualification_level public.qualification_level,
  age_min                 smallint,
  age_max                 smallint,
  experience_years_min    smallint,
  gender                  public.gender_eligibility not null default 'any',
  required_skills         text[] not null default '{}',

  -- ── Classification ──────────────────────────────────────────────────────
  tags                    text[] not null default '{}',
  status                  public.job_status not null default 'draft',
  is_featured             boolean not null default false,

  -- ── Provenance ──────────────────────────────────────────────────────────
  source_url              text,
  -- Stable hash of the source listing. Ingestion upserts on this, which is what
  -- makes a re-run over unchanged data write zero rows.
  dedupe_key              text unique,

  published_at            timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- ── Search ──────────────────────────────────────────────────────────────
  -- Generated and stored, so it is maintained by the database rather than by
  -- whichever code path happened to write the row. Weights: title first, then
  -- what someone would plausibly type next.
  search_vector tsvector generated always as (
    setweight(to_tsvector('public.jt_search', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('public.jt_search', coalesce(qualification_summary, '')), 'B') ||
    setweight(to_tsvector('public.jt_search', coalesce(location, '') || ' ' || coalesce(state, '')), 'B') ||
    setweight(to_tsvector('public.jt_search', public.text_array_to_string(tags, ' ')), 'C')
  ) stored,

  -- ── Semantic search / re-ranking (Module 8) ─────────────────────────────
  -- Added now rather than later: ALTER TABLE ADD COLUMN on 5,861 rows is cheap
  -- today and awkward once the table is live and being revalidated.
  embedding               extensions.vector(384),

  constraint jobs_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint jobs_title_not_blank check (length(btrim(title)) > 0),
  constraint jobs_age_range check (age_min is null or age_max is null or age_min <= age_max),
  constraint jobs_salary_range check (salary_min is null or salary_max is null or salary_min <= salary_max),
  constraint jobs_dates_ordered check (
    application_start_date is null or last_date is null or application_start_date <= last_date
  ),
  -- A published row is one a visitor can act on. Enforcing the minimum here
  -- means a half-scraped listing cannot reach the site by accident.
  constraint jobs_published_has_essentials check (
    status <> 'published' or (organization_id is not null and last_date is not null)
  )
);

comment on table public.jobs is
  'Card-level job data. Everything a list or card renders, and nothing else — '
  'prose and JSONB live in job_details. Target ~400 bytes per row.';
comment on column public.jobs.dedupe_key is
  'Stable hash of the source listing. Ingestion upserts on this so a re-run '
  'over unchanged data writes zero rows.';
comment on column public.jobs.search_vector is
  'Generated tsvector, weighted A=title B=qualification/location C=tags. '
  'Maintained by the database, so it cannot drift from the row it describes.';

-- ── Indexes ────────────────────────────────────────────────────────────────

-- The list query. Keyset pagination orders by (published_at desc, id desc);
-- carrying both in the index means page N costs the same as page 1, which is
-- the whole point of not using OFFSET.
create index jobs_feed_idx
  on public.jobs (status, published_at desc, id desc);

-- Full-text search, and the tag/skill filters.
create index jobs_search_idx  on public.jobs using gin (search_vector);
create index jobs_tags_idx    on public.jobs using gin (tags);
create index jobs_skills_idx  on public.jobs using gin (required_skills);

-- Fuzzy and prefix matching on title, for the search-as-you-type box.
create index jobs_title_trgm_idx
  on public.jobs using gin (title extensions.gin_trgm_ops);

-- Organization landing pages, and the "more from this body" rail.
create index jobs_organization_idx
  on public.jobs (organization_id, published_at desc)
  where status = 'published';

-- Deadline sorting and the closing-soon shelf.
create index jobs_last_date_idx
  on public.jobs (last_date)
  where status = 'published';

-- Module 8's eligibility prefilter, before any ranking runs.
create index jobs_eligibility_idx
  on public.jobs (status, min_qualification_level, age_min, age_max)
  where status = 'published';

create trigger jobs_touch_updated_at
  before update on public.jobs
  for each row execute function public.touch_updated_at();

alter table public.jobs enable row level security;


-- ═══════════════════════════════════════════════════════════════════════════
-- job_details — the cold half
-- ═══════════════════════════════════════════════════════════════════════════
-- One row per job, read only by the detail page and the admin editor. Never
-- joined into a list query.

create table public.job_details (
  job_id              uuid primary key references public.jobs (id) on delete cascade,

  description         text,
  eligibility_text    text,
  experience_text     text,

  apply_link          text,
  official_website    text,
  notification_pdf    text,

  important_dates     jsonb,
  application_fees    jsonb,
  vacancies_detail    jsonb,
  selection_process   jsonb,
  overview            jsonb,

  -- Structured eligibility the parser produced. The typed columns on `jobs`
  -- are derived from this; it is kept for the admin editor and for re-deriving
  -- those columns when the parser improves.
  eligibility_profile jsonb,

  -- Untouched scraper output. Costs almost nothing (TOAST-compressed, and read
  -- by nothing on the hot path) and has repeatedly been the difference between
  -- diagnosing a parser bug and re-scraping 5,000 pages to reproduce it.
  raw                 jsonb,

  updated_at          timestamptz not null default now()
);

comment on table public.job_details is
  'Cold half of a job: prose and JSONB. Read by the detail page and the admin '
  'editor only. A list query cannot reach this table, which is the point.';

create trigger job_details_touch_updated_at
  before update on public.job_details
  for each row execute function public.touch_updated_at();

alter table public.job_details enable row level security;
