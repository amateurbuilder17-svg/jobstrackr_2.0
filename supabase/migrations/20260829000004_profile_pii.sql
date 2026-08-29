-- ═══════════════════════════════════════════════════════════════════════════
-- 0029 · Module 23 · The identity fields, encrypted
-- ═══════════════════════════════════════════════════════════════════════════
-- The highest-risk migration in this repo. It adds the columns a government
-- application form asks for, and three of them are national identity numbers.
--
-- ── Why the old scheme is not ported ──────────────────────────────────────
-- The old project encrypted these too, with:
--
--     encryption_key := owner_id::TEXT || '_lovable_secure_salt_2024';
--
-- That is not encryption. The key is the row's own primary key concatenated
-- with a constant that ships in the migration, so anyone holding the database
-- holds both halves for every row. It would pass an audit checklist that reads
-- "are identity numbers encrypted at rest?" and protect nobody.
--
-- This uses the pattern migration 0024 already established for the API key
-- pool: a random 32-byte secret in Vault, pgp_sym_encrypt, and armor. The key
-- is not derivable from anything in the table.
--
-- ── The two-column shape ──────────────────────────────────────────────────
-- Each identity number is stored twice:
--
--     aadhaar_number             '****1234'   — masked, safe to select
--     aadhaar_number_encrypted   <pgp>        — never selected by the app
--
-- The trigger below overwrites the plaintext with its mask on the way in, so
-- the readable column never holds a full number even for an instant. Every
-- ordinary read path — the profile page, the app's PROFILE_COLUMNS select —
-- sees only the mask. Exactly one function returns the real value, to the
-- owner, one field at a time.
--
-- ── Spelling ──────────────────────────────────────────────────────────────
-- `aadhaar`, which is how UIDAI spells it. The old project's column was
-- `aadhar`; the migration script in docs/ACCOUNT-MIGRATION.md maps the two.

-- ── Ordinary fields ────────────────────────────────────────────────────────
-- Nothing here is secret, but all of it is personal: it is only ever readable
-- by its owner, which the existing profiles RLS policy already guarantees.

alter table public.profiles
  add column father_name                   text,
  add column mother_name                   text,
  add column address                       text,
  add column pincode                       text,
  add column marital_status                text,
  add column current_status                text,

  -- Reservation detail beyond the `category` enum the matcher uses. A caste
  -- certificate's number and issuing authority are asked for by name on most
  -- application forms, which is the whole reason this module exists.
  add column sub_category                  text,
  add column caste_name                    text,
  add column caste_certificate_number      text,
  add column caste_issuing_authority       text,
  add column caste_issue_date              date,

  add column ews_certificate_number        text,
  add column ews_issuing_authority         text,

  add column disability_type               text,
  add column disability_certificate_number text,

  add constraint profiles_pincode_shape check (
    pincode is null or pincode ~ '^[1-9][0-9]{5}$'
  ),
  add constraint profiles_marital_status_known check (
    marital_status is null
    or marital_status in ('single', 'married', 'divorced', 'widowed')
  );

comment on column public.profiles.current_status is
  'Free text: "student", "working", "preparing". Asked for by some forms.';


-- ── Identity numbers ───────────────────────────────────────────────────────
alter table public.profiles
  add column aadhaar_number             text,
  add column aadhaar_number_encrypted   text,
  add column pan_number                 text,
  add column pan_number_encrypted       text,
  add column passport_number            text,
  add column passport_number_encrypted  text;

comment on column public.profiles.aadhaar_number is
  'MASKED, always: ****1234. The trigger overwrites whatever is written here '
  'with the last four digits. Never contains a full number.';
comment on column public.profiles.aadhaar_number_encrypted is
  'pgp_sym_encrypt + armor, under the Vault secret profile_pii_key. Read only '
  'through decrypt_own_id(), which returns the owner their own value.';


-- ── The key ────────────────────────────────────────────────────────────────
-- Generated once, into Vault, and never written down here. Regenerating it
-- would leave every stored number undecryptable, so the `if null` guard is
-- what makes this migration safe to re-run.
do $$
declare crypt_key text;
begin
  select decrypted_secret into crypt_key
    from vault.decrypted_secrets where name = 'profile_pii_key';

  if crypt_key is null then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'profile_pii_key',
      'Symmetric key for the identity numbers on public.profiles'
    );
  end if;
end $$;


-- ── Encrypt on the way in ──────────────────────────────────────────────────
-- A trigger rather than something the application must remember. "The one
-- update that forgot to encrypt" is precisely the row that ends up in a
-- screenshot, and there is no way to notice it afterwards — the column looks
-- the same either way until somebody reads it.
create or replace function public.encrypt_profile_ids()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  crypt_key text;
  masked    text;
begin
  select decrypted_secret into crypt_key
    from vault.decrypted_secrets where name = 'profile_pii_key';

  if crypt_key is null then
    -- Refuse rather than store plaintext. Unlike the API key pool, where a
    -- missing Vault secret degrades to an unencrypted key and a working
    -- feature, storing an unencrypted Aadhaar number is the failure this
    -- entire migration exists to prevent.
    raise exception 'vault secret profile_pii_key is missing; refusing to store identity numbers';
  end if;

  -- Aadhaar: 12 digits, shown as the last four.
  if new.aadhaar_number is distinct from coalesce(old.aadhaar_number, '')
     and new.aadhaar_number is not null
     and new.aadhaar_number !~ '^\*+' then
    masked := '****' || right(regexp_replace(new.aadhaar_number, '\D', '', 'g'), 4);
    new.aadhaar_number_encrypted :=
      extensions.armor(extensions.pgp_sym_encrypt(new.aadhaar_number, crypt_key));
    new.aadhaar_number := masked;
  end if;

  -- PAN: ten characters, shown as the last four.
  if new.pan_number is distinct from coalesce(old.pan_number, '')
     and new.pan_number is not null
     and new.pan_number !~ '^\*+' then
    new.pan_number_encrypted :=
      extensions.armor(extensions.pgp_sym_encrypt(upper(new.pan_number), crypt_key));
    new.pan_number := '****' || right(upper(new.pan_number), 4);
  end if;

  if new.passport_number is distinct from coalesce(old.passport_number, '')
     and new.passport_number is not null
     and new.passport_number !~ '^\*+' then
    new.passport_number_encrypted :=
      extensions.armor(extensions.pgp_sym_encrypt(upper(new.passport_number), crypt_key));
    new.passport_number := '****' || right(upper(new.passport_number), 4);
  end if;

  -- Clearing a field clears both halves. Without this, deleting your Aadhaar
  -- number from the form would blank the mask and leave the encrypted value
  -- behind — still readable through decrypt_own_id, by a person who believes
  -- they have removed it.
  if new.aadhaar_number is null then new.aadhaar_number_encrypted := null; end if;
  if new.pan_number is null then new.pan_number_encrypted := null; end if;
  if new.passport_number is null then new.passport_number_encrypted := null; end if;

  return new;
end $$;

create trigger profiles_encrypt_ids
  before insert or update on public.profiles
  for each row execute function public.encrypt_profile_ids();


-- ── Read one, as its owner ─────────────────────────────────────────────────
-- The only route back to a real number, and the single most security-sensitive
-- function in this schema.
--
-- SECURITY DEFINER, because it must reach Vault — which is exactly why it
-- checks the caller itself and takes no user id. There is deliberately no
-- `p_user_id` parameter: a function that accepted one would be a way for any
-- authenticated user to read anyone's Aadhaar number, and no amount of
-- application-level care would fix that.
create or replace function public.decrypt_own_id(p_field text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  crypt_key text;
  payload   text;
  uid       uuid := (select auth.uid());
begin
  if uid is null then return null; end if;

  if p_field not in ('aadhaar', 'pan', 'passport') then
    raise exception 'unknown field %', p_field;
  end if;

  select case p_field
           when 'aadhaar'  then aadhaar_number_encrypted
           when 'pan'      then pan_number_encrypted
           when 'passport' then passport_number_encrypted
         end
    into payload
    from public.profiles
    where id = uid;

  if payload is null then return null; end if;

  select decrypted_secret into crypt_key
    from vault.decrypted_secrets where name = 'profile_pii_key';
  if crypt_key is null then return null; end if;

  return extensions.pgp_sym_decrypt(extensions.dearmor(payload), crypt_key);
exception when others then
  -- A value encrypted under a rotated secret. Null rather than an error, so
  -- the page says "we cannot read this, re-enter it" instead of a 500.
  return null;
end $$;

comment on function public.decrypt_own_id is
  'Returns the CALLING user their own identity number. Takes no user id by '
  'design — auth.uid() is the only subject it will ever read.';

revoke all on function public.decrypt_own_id(text) from public, anon;
grant execute on function public.decrypt_own_id(text) to authenticated;
