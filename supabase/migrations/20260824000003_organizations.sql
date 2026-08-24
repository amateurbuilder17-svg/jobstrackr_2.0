-- ═══════════════════════════════════════════════════════════════════════════
-- 0003 · Organizations (conducting bodies)
-- ═══════════════════════════════════════════════════════════════════════════
-- The old schema carried `department` as free text on all 5,861 job rows, which
-- meant "Staff Selection Commission", "SSC" and "Staff Selection Commision"
-- were three different employers as far as any filter was concerned. Logos were
-- resolved client-side by a 13 kB lookup hook.
--
-- Normalising gives one canonical name, one logo, a filter that is an indexed
-- join instead of a string scan, and a natural home for the /organization/:slug
-- landing pages Module 5 wants for SEO.

create table public.organizations (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  short_name    text,
  aliases       text[] not null default '{}',
  logo_path     text,
  website       text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint organizations_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint organizations_name_not_blank check (length(btrim(name)) > 0)
);

comment on table public.organizations is
  'Conducting bodies — SSC, UPSC, state PSCs, PSUs, banks. One row per employer.';
comment on column public.organizations.aliases is
  'Alternate spellings seen in scraped listings, used to resolve an incoming '
  'department string to this row. Ingestion matches against name, short_name '
  'and this array before creating anything new.';
comment on column public.organizations.logo_path is
  'Storage path, not a URL. Keeps the CDN origin swappable without a data migration.';

create index organizations_active_name_idx
  on public.organizations (name)
  where is_active;

-- Resolving a scraped department string to an organization is a fuzzy match
-- against name/short_name/aliases, run once per ingested row — not per request.
create index organizations_aliases_idx on public.organizations using gin (aliases);
create index organizations_name_trgm_idx
  on public.organizations using gin (name extensions.gin_trgm_ops);

create trigger organizations_touch_updated_at
  before update on public.organizations
  for each row execute function public.touch_updated_at();

-- RLS is enabled here, at creation, rather than in the later policy migration.
-- Enabling it in a separate step leaves a window — however brief — in which the
-- table exists and is readable by anyone. Policies come in 0010; until then
-- this table is deny-all, which is the correct default.
alter table public.organizations enable row level security;
