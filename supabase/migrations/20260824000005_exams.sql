-- ═══════════════════════════════════════════════════════════════════════════
-- 0005 · Exams
-- ═══════════════════════════════════════════════════════════════════════════
-- Small table (107 rows in the old project) but central: the tracker, the
-- calendar and the countdown all hang off it.

create table public.exams (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  name              text not null,
  short_name        text,
  organization_id   uuid references public.organizations (id) on delete restrict,

  description       text,
  official_website  text,
  logo_path         text,

  -- Denormalised from user_calendar_events / exam_updates at ingest so the
  -- countdown and calendar can render without a correlated subquery per card.
  next_event_at     timestamptz,
  next_event_label  text,

  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  search_vector tsvector generated always as (
    setweight(to_tsvector('public.jt_search', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('public.jt_search', coalesce(short_name, '')), 'A') ||
    setweight(to_tsvector('public.jt_search', coalesce(description, '')), 'C')
  ) stored,

  constraint exams_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint exams_name_not_blank check (length(btrim(name)) > 0)
);

comment on column public.exams.next_event_at is
  'Denormalised at ingest so a countdown card renders without a per-row '
  'subquery. Recomputed by the sync worker, never written by the app.';

create index exams_search_idx on public.exams using gin (search_vector);
create index exams_next_event_idx on public.exams (next_event_at) where is_active;
create index exams_organization_idx on public.exams (organization_id);

create trigger exams_touch_updated_at
  before update on public.exams
  for each row execute function public.touch_updated_at();

alter table public.exams enable row level security;
