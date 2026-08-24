-- ═══════════════════════════════════════════════════════════════════════════
-- RLS proof. Every check raises on failure, so the script exits non-zero.
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

-- ── Two users, each with their own data ────────────────────────────────────
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'alice@example.com'),
  ('22222222-2222-4222-8222-222222222222', 'mallory@example.com');

update public.profiles set full_name = 'Alice',   state = 'Odisha'
  where id = '11111111-1111-4111-8111-111111111111';
update public.profiles set full_name = 'Mallory', state = 'Delhi'
  where id = '22222222-2222-4222-8222-222222222222';

insert into public.organizations (id, slug, name) values
  ('33333333-3333-4333-8333-333333333333', 'ssc', 'Staff Selection Commission');

insert into public.jobs (id, slug, title, organization_id, status, last_date, published_at) values
  ('44444444-4444-4444-8444-444444444444', 'ssc-cgl-2026', 'SSC CGL 2026',
   '33333333-3333-4333-8333-333333333333', 'published', current_date + 30, now()),
  ('55555555-5555-4555-8555-555555555555', 'secret-draft', 'Unpublished Draft',
   '33333333-3333-4333-8333-333333333333', 'draft', current_date + 30, now());

insert into public.saved_jobs (user_id, job_id) values
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444');

insert into public.user_roles (user_id, role) values
  ('22222222-2222-4222-8222-222222222222', 'admin');

-- ═══ 1. Anonymous visitor ═══════════════════════════════════════════════════
-- Explicit transaction: `set local` is scoped to one, and psql's implicit
-- per-statement transactions would discard it — leaving these checks running
-- as the table owner, who bypasses RLS and passes everything vacuously.
begin;
set local role anon;
set local request.jwt.claim.sub = '';

select pg_temp.check('anon sees published jobs',
  (select count(*) from public.jobs)::int, 1);
select pg_temp.check('anon CANNOT see draft jobs',
  (select count(*) from public.jobs where slug = 'secret-draft')::int, 0);
select pg_temp.check('anon sees active organizations',
  (select count(*) from public.organizations)::int, 1);

do $$ begin
  perform 1 from public.profiles;
  raise exception 'FAIL  anon reached profiles — it should lack the SELECT grant entirely';
exception
  when insufficient_privilege then raise notice '  ok   anon BLOCKED from profiles (no grant)';
end $$;

do $$ begin
  perform 1 from public.saved_jobs;
  raise exception 'FAIL  anon reached saved_jobs';
exception
  when insufficient_privilege then raise notice '  ok   anon BLOCKED from saved_jobs (no grant)';
end $$;

do $$ begin
  insert into public.jobs (slug, title, status, last_date)
  values ('injected', 'Injected By Anon', 'published', current_date);
  raise exception 'FAIL  anon INSERTED a job';
exception
  when insufficient_privilege then raise notice '  ok   anon BLOCKED from writing jobs';
end $$;

rollback;

-- ═══ 2. Mallory, signed in, trying to reach Alice's data ════════════════════
begin;
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-4222-8222-222222222222';

select pg_temp.check('mallory sees only her own profile',
  (select count(*) from public.profiles)::int, 1);
select pg_temp.check('...and it is hers',
  (select full_name from public.profiles), 'Mallory'::text);
select pg_temp.check('mallory CANNOT see alice saved_jobs',
  (select count(*) from public.saved_jobs)::int, 0);
select pg_temp.check('mallory CANNOT target alice by id',
  (select count(*) from public.profiles
    where id = '11111111-1111-4111-8111-111111111111')::int, 0);

-- The classic escalation attempt: write a row that claims to belong elsewhere.
do $$ begin
  insert into public.saved_jobs (user_id, job_id)
  values ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444');
  raise exception 'FAIL  mallory inserted a row owned by alice';
exception
  when insufficient_privilege then raise notice '  ok   mallory BLOCKED from writing as alice (WITH CHECK)';
end $$;

do $$ begin
  update public.profiles set full_name = 'Owned'
   where id = '11111111-1111-4111-8111-111111111111';
  if found then raise exception 'FAIL  mallory updated alice profile'; end if;
  raise notice '  ok   mallory UPDATE on alice profile affected 0 rows';
end $$;

-- Mallory is an admin, so she legitimately sees drafts. That is the policy
-- working, not a hole — but it must not extend to other users' private rows,
-- which the checks above already established.
select pg_temp.check('admin sees drafts too',
  (select count(*) from public.jobs)::int, 2);

rollback;

-- ═══ 3. Alice, signed in ════════════════════════════════════════════════════
begin;
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';

select pg_temp.check('alice sees her saved job',
  (select count(*) from public.saved_jobs)::int, 1);
select pg_temp.check('alice is NOT an admin',
  public.has_role('admin'), false);
select pg_temp.check('alice does NOT see drafts',
  (select count(*) from public.jobs)::int, 1);
select pg_temp.check('alice sees no role rows',
  (select count(*) from public.user_roles)::int, 0);

-- Self-promotion: the reason roles are not a column on profiles.
do $$ begin
  insert into public.user_roles (user_id, role)
  values ('11111111-1111-4111-8111-111111111111', 'admin');
  raise exception 'FAIL  alice granted herself admin';
exception
  when insufficient_privilege then raise notice '  ok   alice BLOCKED from granting herself admin';
end $$;

rollback;
