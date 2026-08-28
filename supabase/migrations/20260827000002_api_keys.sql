-- ═══════════════════════════════════════════════════════════════════════════
-- 0024 · Module 19 · The API key pool
-- ═══════════════════════════════════════════════════════════════════════════
-- Gemini 3.5 Flash on the free tier is capped per minute and per day, and the
-- cap is enforced with a 429. One key therefore is not a configuration detail —
-- it is the feature's ceiling. Ten keys, tried in order and rotated past on a
-- 429, is what the old project did and it is why its scrapers kept working.
--
-- This is that table, brought across unchanged in shape so the ten rows the old
-- project holds can be moved in as they are:
--
--   provider / model_name   which API to call and with what model
--   priority                the order to try them in
--   is_active               a dead key is switched off, not deleted
--   last_error / updated_at together, these are the cooldown: a key that 429'd
--                           in the last 65 seconds sorts to the back
--   total_calls / total_errors  which key is carrying the load, and which is failing
--
-- Why a table rather than ten environment variables: the counters. A rotation
-- pool whose health nobody can see is a pool that silently degrades to one
-- working key, and the first anyone hears of it is the feature going quiet.
-- Environment variables remain a fallback — see `loadApiKeys` — so a deployment
-- with no rows still works.

-- The keys are encrypted at rest with a Vault-held symmetric key, exactly as
-- the old project's P1 remediation left them. Nothing but the secret key can
-- read this table at all (there is no grant below), so this is defence against
-- a leaked dump rather than against an API caller.
create extension if not exists pgcrypto with schema extensions;

create table public.api_keys_config (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null default 'gemini',
  model_name   text not null default 'gemini-3.5-flash',

  -- Written in plaintext, stored PGP-armored by the trigger below. Read back
  -- through `decrypted_api_keys_config`, never from here.
  api_key      text not null,

  is_active    boolean not null default true,
  priority     integer not null default 0,
  label        text,

  last_used_at timestamptz,
  -- Prefixed with the status code, because the loader distinguishes a
  -- rate-limited key (temporary, sort it to the back) from a broken one
  -- (permanent, `is_active` goes false) by reading '429:' off the front.
  last_error   text,

  total_calls  integer not null default 0,
  total_errors integer not null default 0,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint api_keys_provider_known
    check (provider in ('gemini', 'groq', 'openai', 'openrouter')),
  constraint api_keys_counts_sane
    check (total_calls >= 0 and total_errors >= 0)
);

comment on table public.api_keys_config is
  'The LLM key rotation pool. Keys are encrypted at rest; read them through '
  'decrypted_api_keys_config with the secret key, never from this table.';

comment on column public.api_keys_config.last_error is
  'Status-code-prefixed. A ''429:'' within the last 65s means cooling down, '
  'not broken — the loader sorts such keys to the back rather than skipping '
  'them, so they remain a last resort.';

-- The loader's exact ordering: active keys, cheapest first, healthiest first.
create index api_keys_active_priority_idx
  on public.api_keys_config (provider, priority, total_errors)
  where is_active;


-- ── The encryption key ─────────────────────────────────────────────────────
-- Generated once, into Vault. Re-running this migration finds the existing
-- secret and leaves it alone — regenerating it would make every stored key
-- undecryptable, which is a quiet, total outage of the feature.
do $$
declare crypt_key text;
begin
  select decrypted_secret into crypt_key
    from vault.decrypted_secrets where name = 'api_keys_encryption_key';

  if crypt_key is null then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'api_keys_encryption_key',
      'Symmetric key for public.api_keys_config'
    );
  end if;
end $$;


-- ── Encrypt on the way in ──────────────────────────────────────────────────
-- A trigger rather than something the application must remember, because "the
-- one insert that forgot to encrypt" is exactly the row that ends up in a
-- screenshot. Loading ten keys is then a plain INSERT of plaintext values.
create or replace function public.encrypt_api_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare crypt_key text;
begin
  if tg_op = 'UPDATE' and new.api_key is not distinct from old.api_key then
    return new;
  end if;

  -- Already armored: an UPDATE that touches other columns and copies the
  -- stored value back must not encrypt it a second time.
  if new.api_key like '-----BEGIN PGP MESSAGE-----%' then
    return new;
  end if;

  select decrypted_secret into crypt_key
    from vault.decrypted_secrets where name = 'api_keys_encryption_key';

  if crypt_key is null then
    raise exception 'vault secret api_keys_encryption_key is missing';
  end if;

  new.api_key := extensions.armor(extensions.pgp_sym_encrypt(new.api_key, crypt_key));
  return new;
end $$;

create trigger api_keys_encrypt
  before insert or update on public.api_keys_config
  for each row execute function public.encrypt_api_key();

create trigger api_keys_touch_updated_at
  before update on public.api_keys_config
  for each row execute function public.touch_updated_at();


-- ── Decrypt on the way out ─────────────────────────────────────────────────
-- SECURITY DEFINER, so it can reach Vault — and therefore it checks the caller
-- itself. Without that check this function would be a way for any authenticated
-- user to read every key in the table.
create or replace function public.decrypt_api_key(encrypted_key text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare crypt_key text;
begin
  if not (auth.role() = 'service_role' or public.has_role('admin')) then
    return null;
  end if;

  select decrypted_secret into crypt_key
    from vault.decrypted_secrets where name = 'api_keys_encryption_key';

  -- No Vault key configured means the column holds plaintext. Returning it is
  -- correct rather than lenient: the alternative is a feature that fails
  -- opaquely on a project where Vault was never set up.
  if crypt_key is null then return encrypted_key; end if;

  if encrypted_key like '-----BEGIN PGP MESSAGE-----%' then
    return extensions.pgp_sym_decrypt(extensions.dearmor(encrypted_key), crypt_key);
  end if;

  return encrypted_key;
exception when others then
  -- A key encrypted under a rotated Vault secret. Null, so the loader skips it
  -- and tries the next key, rather than sending garbage to Google and marking
  -- a healthy key as broken.
  return null;
end $$;

comment on function public.decrypt_api_key is
  'Returns null to an unauthorised caller and to a key it cannot decrypt. The '
  'loader treats null as "skip this key", so neither case takes the pool down.';

create or replace view public.decrypted_api_keys_config
with (security_invoker = on) as
select
  id, provider, model_name, is_active, priority, label,
  last_used_at, last_error, total_calls, total_errors,
  created_at, updated_at,
  public.decrypt_api_key(api_key) as api_key
from public.api_keys_config;

comment on view public.decrypted_api_keys_config is
  'What the app reads. security_invoker so the caller''s own permissions on '
  'api_keys_config apply — the view is not a way around them.';


-- ── Who can see any of this ────────────────────────────────────────────────
alter table public.api_keys_config enable row level security;

-- No grant to anon or authenticated, on the table or the view. The secret key
-- bypasses RLS and is the only reader. There is deliberately no admin policy:
-- this app has no key-management screen, and a policy written for a UI that
-- does not exist is an open door with nothing behind it. Add both together.
revoke all on function public.decrypt_api_key(text) from public;
