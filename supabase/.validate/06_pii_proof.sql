-- ═══════════════════════════════════════════════════════════════════════════
-- Module 23 gate: the identity numbers.
--
-- This is the file that decides whether M23 ships. It stores real-shaped
-- Aadhaar, PAN and passport numbers for two users and then tries, from
-- Mallory's session, every route to Alice's — through the table, through the
-- decrypt function, and through the encrypted column directly.
--
-- Every check raises on failure, so the script exits non-zero.
-- ═══════════════════════════════════════════════════════════════════════════
\set ON_ERROR_STOP on

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL  %  — got %, expected %', label, got, want;
  end if;
  raise notice '  ok   %', label;
end $$;

create or replace function pg_temp.check_true(label text, got boolean)
returns void language plpgsql as $$
begin
  if got is not true then
    raise exception 'FAIL  %  — expected true', label;
  end if;
  raise notice '  ok   %', label;
end $$;

-- ── Two users, each with their own identity numbers ────────────────────────
insert into auth.users (id, email) values
  ('d1111111-0000-4000-8000-000000000aa1', 'alice.pii@example.com'),
  ('d2222222-0000-4000-8000-000000000bb2', 'mallory.pii@example.com');

update public.profiles
   set full_name       = 'Alice',
       aadhaar_number  = '123412341234',
       pan_number      = 'ABCDE1234F',
       passport_number = 'M1234567'
 where id = 'd1111111-0000-4000-8000-000000000aa1';

update public.profiles
   set full_name      = 'Mallory',
       aadhaar_number = '999999999999'
 where id = 'd2222222-0000-4000-8000-000000000bb2';


-- ── 1. The readable column never holds a full number ───────────────────────
-- Checked as the table owner, with RLS off entirely: not "the app cannot see
-- it" but "it is not there".
select pg_temp.check(
  'aadhaar is stored masked, not in full',
  (select aadhaar_number from public.profiles where id = 'd1111111-0000-4000-8000-000000000aa1'),
  '****1234'
);

select pg_temp.check(
  'pan is stored masked',
  (select pan_number from public.profiles where id = 'd1111111-0000-4000-8000-000000000aa1'),
  '****234F'
);

select pg_temp.check(
  'passport is stored masked',
  (select passport_number from public.profiles where id = 'd1111111-0000-4000-8000-000000000aa1'),
  '****4567'
);

-- The whole point of the migration: a dump of this table contains no readable
-- identity number anywhere, in either column.
select pg_temp.check(
  'no full aadhaar survives anywhere in the row',
  (select count(*) from public.profiles
    where aadhaar_number like '%123412341234%'
       or aadhaar_number_encrypted like '%123412341234%'),
  0::bigint
);

select pg_temp.check_true(
  'the encrypted column really is pgp, not the plaintext',
  (select aadhaar_number_encrypted like '-----BEGIN PGP MESSAGE-----%'
     from public.profiles where id = 'd1111111-0000-4000-8000-000000000aa1')
);


-- ── 2. The owner can read their own ────────────────────────────────────────
-- Explicit transaction: `set local` is scoped to one, and psql's implicit
-- per-statement transaction discards it before the next line runs.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd1111111-0000-4000-8000-000000000aa1';

select pg_temp.check(
  'alice reads her own aadhaar',
  public.decrypt_own_id('aadhaar'),
  '123412341234'
);
select pg_temp.check('alice reads her own pan', public.decrypt_own_id('pan'), 'ABCDE1234F');
select pg_temp.check('alice reads her own passport', public.decrypt_own_id('passport'), 'M1234567');

commit;


-- ── 3. THE GATE — Mallory cannot reach Alice's ─────────────────────────────
-- The module does not ship if any of these returns Alice's number.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd2222222-0000-4000-8000-000000000bb2';

-- The function takes no user id at all, so the only thing Mallory can ask for
-- is her own. This asserts that what she gets back is hers and not Alice's.
select pg_temp.check(
  'decrypt_own_id returns the CALLER, never a passed-in subject',
  public.decrypt_own_id('aadhaar'),
  '999999999999'
);

-- RLS hides Alice's row, so there is no encrypted payload to take away and
-- attack offline.
select pg_temp.check(
  'mallory cannot select alice''s encrypted column',
  (select count(*) from public.profiles where id = 'd1111111-0000-4000-8000-000000000aa1'),
  0::bigint
);

select pg_temp.check(
  'mallory sees exactly one profile — her own',
  (select count(*) from public.profiles),
  1::bigint
);

-- An unknown field name is refused rather than silently returning null, so a
-- typo in the app is loud instead of looking like "no value stored".
do $$
begin
  perform public.decrypt_own_id('full_name');
  raise exception 'FAIL  decrypt_own_id accepted an arbitrary field name';
exception
  when sqlstate '42704' or sqlstate 'P0001' then
    raise notice '  ok   decrypt_own_id refuses an unknown field';
  when others then
    if sqlerrm like 'unknown field%' then
      raise notice '  ok   decrypt_own_id refuses an unknown field';
    else
      raise;
    end if;
end $$;

commit;


-- ── 4. An anonymous visitor gets nothing ───────────────────────────────────
begin;
set local role anon;
set local request.jwt.claim.sub = '';

do $$
begin
  perform public.decrypt_own_id('aadhaar');
  raise exception 'FAIL  anon was allowed to execute decrypt_own_id';
exception
  when insufficient_privilege then
    raise notice '  ok   anon may not execute decrypt_own_id at all';
end $$;

commit;


-- ── 5. Clearing a number clears both halves ────────────────────────────────
-- Otherwise deleting your Aadhaar from the form blanks the mask and leaves the
-- encrypted value readable, for a person who believes they removed it.
update public.profiles set aadhaar_number = null
 where id = 'd1111111-0000-4000-8000-000000000aa1';

select pg_temp.check(
  'clearing the mask clears the ciphertext too',
  (select aadhaar_number_encrypted from public.profiles
    where id = 'd1111111-0000-4000-8000-000000000aa1'),
  null::text
);


-- ── 6. Re-saving an unchanged masked value does not double-encrypt ─────────
-- The profile form posts back what it was given, which is the mask. Encrypting
-- '****234F' would destroy the real number with no way to notice.
update public.profiles set full_name = 'Alice Updated'
 where id = 'd1111111-0000-4000-8000-000000000aa1';

-- Explicit transaction: `set local` is scoped to one, and psql's implicit
-- per-statement transaction discards it before the next line runs.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd1111111-0000-4000-8000-000000000aa1';
select pg_temp.check(
  'an unrelated profile update leaves pan intact',
  public.decrypt_own_id('pan'),
  'ABCDE1234F'
);
commit;

update public.profiles set pan_number = '****234F'
 where id = 'd1111111-0000-4000-8000-000000000aa1';

-- Explicit transaction: `set local` is scoped to one, and psql's implicit
-- per-statement transaction discards it before the next line runs.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd1111111-0000-4000-8000-000000000aa1';
select pg_temp.check(
  'writing the mask back does not overwrite the real value',
  public.decrypt_own_id('pan'),
  'ABCDE1234F'
);
commit;


-- ═══════════════════════════════════════════════════════════════════════════
-- Module 25 gate: document storage.
--
-- The old project checked ownership inside the edge function:
--
--     if (fileOwnerId !== user.id && !isAdmin) { return 403 }
--
-- which held for exactly as long as every future caller remembered to write it.
-- It is a storage policy now, and this proves the policy — not the code.
-- ═══════════════════════════════════════════════════════════════════════════

-- Alice and Mallory each upload one document, as themselves.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd1111111-0000-4000-8000-000000000aa1';
insert into storage.objects (bucket_id, name)
  values ('documents', 'd1111111-0000-4000-8000-000000000aa1/aadhaar.jpg');
commit;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd2222222-0000-4000-8000-000000000bb2';
insert into storage.objects (bucket_id, name)
  values ('documents', 'd2222222-0000-4000-8000-000000000bb2/marksheet.jpg');
commit;

-- ── Mallory against Alice's file ───────────────────────────────────────────
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd2222222-0000-4000-8000-000000000bb2';

select pg_temp.check(
  'mallory cannot read alice''s document',
  (select count(*) from storage.objects
    where name = 'd1111111-0000-4000-8000-000000000aa1/aadhaar.jpg'),
  0::bigint
);

select pg_temp.check(
  'mallory sees only her own documents',
  (select count(*) from storage.objects where bucket_id = 'documents'),
  1::bigint
);

-- A DELETE that matches nothing is how RLS refuses a delete: the row is
-- invisible, so there is nothing to remove and no error either. Counting the
-- rows afterwards is what distinguishes "refused" from "succeeded quietly".
delete from storage.objects
 where name = 'd1111111-0000-4000-8000-000000000aa1/aadhaar.jpg';
commit;

select pg_temp.check(
  'alice''s document survived mallory''s delete',
  (select count(*) from storage.objects
    where name = 'd1111111-0000-4000-8000-000000000aa1/aadhaar.jpg'),
  1::bigint
);

-- Writing INTO someone else's folder is the other half, and the one an
-- application-level check usually forgets: it is not a read, so a "can you see
-- this file" guard never runs.
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'd2222222-0000-4000-8000-000000000bb2', true);
  begin
    insert into storage.objects (bucket_id, name)
      values ('documents', 'd1111111-0000-4000-8000-000000000aa1/planted.jpg');
    raise exception 'FAIL  mallory planted a file in alice''s folder';
  exception when insufficient_privilege then
    raise notice '  ok   mallory cannot write into alice''s folder';
  end;
end $$;

-- ── The bucket is private ──────────────────────────────────────────────────
select pg_temp.check(
  'the documents bucket is not public',
  (select public from storage.buckets where id = 'documents'),
  false
);

-- ── Alice still has hers ───────────────────────────────────────────────────
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'd1111111-0000-4000-8000-000000000aa1';
select pg_temp.check(
  'alice reads her own document',
  (select count(*) from storage.objects
    where name = 'd1111111-0000-4000-8000-000000000aa1/aadhaar.jpg'),
  1::bigint
);
commit;
