-- ═══════════════════════════════════════════════════════════════════════════
-- 0007 · Profiles and roles
-- ═══════════════════════════════════════════════════════════════════════════
-- 99 accounts in the old project, 33 of them with a profile. Two thirds signed
-- up and stopped. Everything optional below is optional on purpose — Module 6
-- asks for a field when it can explain what the field buys you, not up front.

create type public.reservation_category as enum (
  'general', 'ews', 'obc', 'obc_ncl', 'sc', 'st', 'pwd'
);

create table public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,

  full_name             text,
  avatar_path           text,
  phone                 text,

  -- Date of birth, not age. Age is derived at query time; storing it would be
  -- wrong within a year and silently wrong forever after.
  date_of_birth         date,
  gender                public.gender_eligibility,
  category              public.reservation_category,

  state                 text,
  district              text,

  -- Matching inputs (Module 8), kept typed for the same reason as on jobs.
  highest_qualification public.qualification_level,
  experience_years      smallint,
  preferred_sectors     text[] not null default '{}',
  preferred_states      text[] not null default '{}',

  -- Built at ingest from the profile's own text, never in the browser. The old
  -- app shipped an 806 kB transformer bundle to compute this client-side.
  embedding             extensions.vector(384),

  onboarding_completed  boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint profiles_dob_sane check (
    date_of_birth is null or date_of_birth between '1940-01-01' and current_date
  ),
  constraint profiles_experience_sane check (
    experience_years is null or experience_years between 0 and 60
  )
);

comment on table public.profiles is
  'One row per auth.users row. Created by a trigger on signup so the app never '
  'has to handle a signed-in user with no profile.';
comment on column public.profiles.date_of_birth is
  'Stored instead of age deliberately — a stored age is wrong within a year.';

create index profiles_state_idx on public.profiles (state) where state is not null;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;


-- ── Auto-create a profile on signup ────────────────────────────────────────
-- Without this, every read path needs a "profile might not exist" branch. One
-- trigger removes that branch from the entire application.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ── Roles ──────────────────────────────────────────────────────────────────
-- Deliberately its own table rather than a column on profiles. A role stored on
-- a row the user can update is a privilege-escalation bug waiting to happen;
-- this table is writable by nobody through the API (see 0010).

create table public.user_roles (
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null,
  granted_at  timestamptz not null default now(),
  granted_by  uuid references auth.users (id) on delete set null,

  primary key (user_id, role),
  constraint user_roles_known_role check (role in ('admin', 'editor'))
);

comment on table public.user_roles is
  'Roles live here, never as a column on profiles — a self-updatable role '
  'column is a privilege-escalation bug by construction. No API write policy '
  'exists for this table; grants happen out of band.';

create index user_roles_role_idx on public.user_roles (role);

alter table public.user_roles enable row level security;

-- ── Role check ─────────────────────────────────────────────────────────────
-- SECURITY DEFINER so it can read user_roles from inside a policy that guards
-- user_roles — without that, the policy recurses on itself.
--
-- `set search_path = ''` is not stylistic. A SECURITY DEFINER function with a
-- mutable search_path can be hijacked by any caller able to create a same-named
-- object in a schema they control, and this function decides who is an admin.
-- Everything below is therefore schema-qualified.
create or replace function public.has_role(check_role text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.user_roles ur
    where ur.user_id = (select auth.uid())
      and ur.role = check_role
  );
$$;

comment on function public.has_role is
  'True when the current user holds the named role. SECURITY DEFINER with a '
  'pinned search_path so policies on user_roles do not recurse and the '
  'function cannot be hijacked via search_path.';
