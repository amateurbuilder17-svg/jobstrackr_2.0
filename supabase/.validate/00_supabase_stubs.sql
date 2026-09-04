-- Local validation only — NOT a migration, never applied to a real project.
-- Supabase provides these; this stub lets migrations be checked against a
-- vanilla Postgres container before they are pushed anywhere real.
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  encrypted_password text,
  raw_user_meta_data jsonb,
  created_at timestamptz default now(),
  -- Real `auth.users` carries this; the admin users page reads it to show who
  -- is still coming back. Stubbed here so the migration that selects it can be
  -- proved on a vanilla container.
  last_sign_in_at timestamptz
);
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;
do $$ begin
  create role anon;          exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated; exception when duplicate_object then null; end $$;
do $$ begin
  create role service_role;  exception when duplicate_object then null; end $$;

-- Supabase grants these on a real project. Without them a policy that calls
-- auth.uid() fails with "permission denied for schema auth" the moment it is
-- evaluated as anything other than the owner — which looks like a broken
-- policy rather than a missing grant in this stub.
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant execute on function auth.role() to anon, authenticated, service_role;

-- ── Vault ──────────────────────────────────────────────────────────────────
-- Supabase provides this; migration 0024 stores the API-key encryption secret
-- in it. The stub is deliberately NOT encrypted — it exists so the migration's
-- DDL, trigger and view can be applied and proved on a vanilla container, not
-- to reproduce Vault's own guarantees.
create schema if not exists vault;

create table if not exists vault.secrets (
  id          uuid primary key default gen_random_uuid(),
  name        text unique,
  secret      text not null,
  description text default '',
  created_at  timestamptz default now()
);

create or replace view vault.decrypted_secrets as
  select id, name, description, created_at, secret as decrypted_secret from vault.secrets;

create or replace function vault.create_secret(
  new_secret text, new_name text default null, new_description text default ''
) returns uuid language sql as $$
  insert into vault.secrets (name, secret, description)
  values (new_name, new_secret, new_description)
  on conflict (name) do update set secret = excluded.secret
  returning id
$$;

-- ── Storage ────────────────────────────────────────────────────────────────
-- Supabase provides this; migration 0030 creates the `documents` bucket in it
-- and attaches four ownership policies to storage.objects. The stub exists so
-- that DDL applies and those policies can be proved on a vanilla container.
--
-- `foldername` is the real function's behaviour and the thing the policies turn
-- on: it splits an object key on '/', so element 1 of `<uid>/<uuid>.jpg` is the
-- owning user's id. Getting this stub wrong would make the proof pass against
-- semantics Supabase does not have, so it is written to match:
-- `storage.foldername('a/b/c.jpg')` is `{a,b}` — the path without the filename.
create schema if not exists storage;

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  public             boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz default now()
);

create table if not exists storage.objects (
  id         uuid primary key default gen_random_uuid(),
  bucket_id  text references storage.buckets (id),
  name       text not null,
  owner      uuid,
  metadata   jsonb,
  created_at timestamptz default now()
);

alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1]
$$;

grant usage on schema storage to anon, authenticated, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.buckets to anon, authenticated;
