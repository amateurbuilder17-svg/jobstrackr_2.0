-- ═══════════════════════════════════════════════════════════════════════════
-- AI exam status: quota, isolation, and the cron queue. Every check raises on
-- failure, so the script exits non-zero.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Three properties, each of which failing would be expensive in a different way:
--
--   1. The quota is a real ceiling. It is the only thing between a signed-in
--      user and unbounded spend on somebody else's API. An in-process bucket
--      cannot do this job — two instances would allow twice the calls — so if
--      this function is wrong, nothing else catches it.
--   2. Reports are readable by every signed-in user and writable by none. The
--      cache is shared on purpose; the writes are not.
--   3. The cron queue picks tracked, stale, still-open subjects and nothing
--      else, and it is unreachable from an API caller.
\set ON_ERROR_STOP on

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL  %  — got %, expected %', label, got, want;
  end if;
  raise notice '  ok   %', label;
end $$;

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'ravi@example.com'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'meera@example.com');

insert into public.organizations (id, slug, name) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'ssc-proof', 'Staff Selection Commission');

insert into public.exams (id, slug, name, organization_id, official_website) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'ssc-cgl-proof', 'SSC CGL',
   'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'https://ssc.gov.in');

-- Two people tracking the same exam. This is the case the shared cache exists
-- for: one refresh must answer both.
insert into public.exam_attempts (user_id, exam_id, status) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'tracking'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'applied');


-- ═══ 1. The quota is a real ceiling ═════════════════════════════════════════
-- Asserted on what the function returns rather than on the table behind it: an
-- API caller has no grant on `ai_usage` (checked below), so reading the counter
-- directly here would fail for the right reason at the wrong moment.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

do $$
declare r record;
begin
  select * into r from public.claim_ai_quota('exam_status', 3, 30);
  if not r.allowed or r.used <> 1 then
    raise exception 'FAIL  first call — allowed=%, used=%', r.allowed, r.used;
  end if;
  raise notice '  ok   the first call is allowed and counts as one';

  -- The cooldown, and the property that matters most about it: a refusal must
  -- not spend quota, or a held-down button burns a day's allowance in a second.
  select * into r from public.claim_ai_quota('exam_status', 3, 30);
  if r.allowed then raise exception 'FAIL  a call inside the cooldown was allowed'; end if;
  raise notice '  ok   a second call inside the cooldown is refused';
  if r.used <> 1 then
    raise exception 'FAIL  the refusal consumed quota — used=%', r.used;
  end if;
  raise notice '  ok   ...and the refusal did NOT consume quota';
  if r.retry_after <= 0 then raise exception 'FAIL  no retry_after on a refusal'; end if;
  raise notice '  ok   ...and it says how long to wait';

  -- Cooldown of zero, to reach the daily limit without waiting for one.
  select * into r from public.claim_ai_quota('exam_status', 3, 0);
  if not r.allowed or r.used <> 2 then raise exception 'FAIL  second call — used=%', r.used; end if;
  select * into r from public.claim_ai_quota('exam_status', 3, 0);
  if not r.allowed or r.used <> 3 then raise exception 'FAIL  third call — used=%', r.used; end if;
  raise notice '  ok   calls are counted up to the limit';

  select * into r from public.claim_ai_quota('exam_status', 3, 0);
  if r.allowed then raise exception 'FAIL  a call over the daily limit was allowed'; end if;
  if r.used <> 3 then raise exception 'FAIL  the counter passed the limit — used=%', r.used; end if;
  raise notice '  ok   the call over the limit is refused, and the counter stops';

  -- The reset is IST midnight, not UTC midnight. A product used entirely in
  -- one timezone whose quota resets at 05:30 local is a support ticket.
  if to_char(timezone('Asia/Kolkata', r.resets_at), 'HH24:MI') <> '00:00' then
    raise exception 'FAIL  quota resets at % India time',
      to_char(timezone('Asia/Kolkata', r.resets_at), 'HH24:MI');
  end if;
  raise notice '  ok   the quota resets at midnight India time';
end $$;

-- One user's spending must not touch another's.
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
do $$
declare r record;
begin
  select * into r from public.claim_ai_quota('exam_status', 3, 0);
  if not r.allowed or r.used <> 1 then
    raise exception 'FAIL  a second user inherited the first one''s quota — used=%', r.used;
  end if;
  raise notice '  ok   a second user starts from zero';
end $$;

rollback;

-- An unauthenticated caller gets nothing, and leaves no row behind to grow.
begin;
set local role anon;
do $$ begin
  perform public.claim_ai_quota('exam_status', 10, 30);
  raise exception 'FAIL  anon reached claim_ai_quota';
exception
  when insufficient_privilege then raise notice '  ok   anon BLOCKED from claim_ai_quota (no grant)';
end $$;
rollback;

select pg_temp.check('no quota rows survive a rolled-back run',
  (select count(*) from public.ai_usage)::int, 0);


-- ═══ 2. Reports are shared to read, closed to write ═════════════════════════
insert into public.exam_status_reports (subject_key, exam_id, subject_label, report, confidence, model, grounded)
values ('exam:dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'SSC CGL',
        '{"stage":"admit_card_available","phases":[],"events":[],"updates":[],"recommendations":[],"summary":null,"confidence":86}'::jsonb,
        86, 'gemini-2.5-flash', true);

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

-- Meera did not pay for this answer. She still sees it, and that is the point:
-- one call serves everyone tracking the exam.
select pg_temp.check('a signed-in user reads a report someone else refreshed',
  (select count(*) from public.exam_status_reports)::int, 1);

do $$ begin
  insert into public.exam_status_reports (subject_key, subject_label, report, model)
  values ('name:forged', 'Forged', '{}'::jsonb, 'none');
  raise exception 'FAIL  a signed-in user wrote to exam_status_reports';
exception
  when insufficient_privilege then raise notice '  ok   users BLOCKED from writing reports (no grant)';
end $$;

do $$ begin
  perform 1 from public.ai_usage;
  raise exception 'FAIL  a signed-in user read ai_usage';
exception
  when insufficient_privilege then raise notice '  ok   users BLOCKED from reading ai_usage (no grant)';
end $$;

rollback;

begin;
set local role anon;
do $$ begin
  perform 1 from public.exam_status_reports;
  raise exception 'FAIL  anon read exam_status_reports';
exception
  when insufficient_privilege then raise notice '  ok   anon BLOCKED from reports (no grant)';
end $$;
rollback;

-- The key shape is enforced by the database as well as by `subjectKeyFor`,
-- because the app is one deploy away from writing a key it never intended to.
do $$ begin
  insert into public.exam_status_reports (subject_key, subject_label, report, model)
  values ('name:', 'Empty key', '{}'::jsonb, 'none');
  raise exception 'FAIL  an empty name key was accepted';
exception
  when check_violation then raise notice '  ok   an empty subject key is refused';
end $$;

do $$ begin
  insert into public.exam_status_reports (subject_key, exam_id, job_id, subject_label, report, model)
  values ('exam:dddddddd-dddd-4ddd-8ddd-ddddddddddde',
          'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
          null, 'Two subjects', '{}'::jsonb, 'none');
  -- job_id is null here, so this must succeed; the constraint only refuses two.
  raise notice '  ok   one subject id is accepted';
end $$;


-- ═══ 3. The cron queue ══════════════════════════════════════════════════════
-- Fresh: nothing to do.
select pg_temp.check('a freshly refreshed subject is not queued',
  (select count(*) from public.stale_status_subjects(6, interval '20 hours')
    where subject_key = 'exam:dddddddd-dddd-4ddd-8ddd-dddddddddddd')::int, 0);

update public.exam_status_reports set refreshed_at = now() - interval '2 days'
 where subject_key = 'exam:dddddddd-dddd-4ddd-8ddd-dddddddddddd';

select pg_temp.check('a stale subject is queued',
  (select count(*) from public.stale_status_subjects(6, interval '20 hours')
    where subject_key = 'exam:dddddddd-dddd-4ddd-8ddd-dddddddddddd')::int, 1);

select pg_temp.check('the queue counts everyone tracking it',
  (select trackers from public.stale_status_subjects(6, interval '20 hours')
    where subject_key = 'exam:dddddddd-dddd-4ddd-8ddd-dddddddddddd'), 2::bigint);

select pg_temp.check('the queue carries the context the prompt needs',
  (select organization || ' | ' || official_website
     from public.stale_status_subjects(6, interval '20 hours')
    where subject_key = 'exam:dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
  'Staff Selection Commission | https://ssc.gov.in');

-- Nothing is learned by re-asking about an attempt its owner has closed. Both
-- trackers close theirs, and the subject leaves the queue entirely.
update public.exam_attempts set status = 'withdrawn'
 where exam_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

select pg_temp.check('a subject nobody is still tracking leaves the queue',
  (select count(*) from public.stale_status_subjects(6, interval '20 hours')
    where subject_key = 'exam:dddddddd-dddd-4ddd-8ddd-dddddddddddd')::int, 0);

-- Free-text attempts are deliberately excluded: two spellings of one exam are
-- two subjects, and refreshing both spends the budget on near-duplicates.
insert into public.exam_attempts (user_id, custom_name, status)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Some Local Board Exam', 'tracking');

select pg_temp.check('a free-text subject is never queued for the cron',
  (select count(*) from public.stale_status_subjects(50, interval '1 second')
    where subject_key like 'name:%')::int, 0);

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$ begin
  perform public.stale_status_subjects(6, interval '20 hours');
  raise exception 'FAIL  a signed-in user reached the cron queue — it aggregates everyone''s rows';
exception
  when insufficient_privilege then raise notice '  ok   users BLOCKED from the cron queue (no grant)';
end $$;
rollback;


-- ═══ 4. Retention ═══════════════════════════════════════════════════════════
-- Both new tables grow without bound by construction. 0009 exists because the
-- old project's logs reached 14.1 MB across 18 tables with no prune anywhere.
select pg_temp.check('prune covers the quota counters',
  (select count(*) from public.prune_operational_data()
    where table_name = 'ai_usage')::int, 1);
select pg_temp.check('prune covers the report cache',
  (select count(*) from public.prune_operational_data()
    where table_name = 'exam_status_reports')::int, 1);


-- ═══ 5. The key pool ════════════════════════════════════════════════════════
-- Ten free-tier keys rotated on a 429 is the whole reason this feature works at
-- all, so the properties that make rotation possible are worth proving: keys go
-- in as plaintext and land encrypted, come back out only for the service key,
-- and survive the stat updates the rotation writes on every call.

insert into public.api_keys_config (provider, model_name, api_key, priority, label)
values ('gemini', 'gemini-2.5-flash', 'AIzaSyPROOF-not-a-real-key', 0, 'proof key');

select pg_temp.check('a key is encrypted on the way in',
  (select api_key like '-----BEGIN PGP MESSAGE-----%' from public.api_keys_config
    where label = 'proof key'), true);

select pg_temp.check('...so the plaintext is not sitting in the column',
  (select count(*) from public.api_keys_config
    where api_key = 'AIzaSyPROOF-not-a-real-key')::int, 0);

begin;
set local request.jwt.claim.role = 'service_role';
select pg_temp.check('the service key reads it back',
  (select api_key from public.decrypted_api_keys_config where label = 'proof key'),
  'AIzaSyPROOF-not-a-real-key');
rollback;

-- The rotation writes counters after every call. If that re-encrypted the
-- stored ciphertext as though it were plaintext, every key would become
-- undecryptable on first use — a total outage, one call in.
update public.api_keys_config
   set total_calls = total_calls + 1, last_used_at = now()
 where label = 'proof key';

begin;
set local request.jwt.claim.role = 'service_role';
select pg_temp.check('recording a call does not corrupt the key',
  (select api_key from public.decrypted_api_keys_config where label = 'proof key'),
  'AIzaSyPROOF-not-a-real-key');
rollback;

-- And an unauthorised caller gets nothing, whichever door they try.
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$ begin
  perform 1 from public.api_keys_config;
  raise exception 'FAIL  a signed-in user read the key table';
exception
  when insufficient_privilege then raise notice '  ok   users BLOCKED from api_keys_config (no grant)';
end $$;
do $$ begin
  perform 1 from public.decrypted_api_keys_config;
  raise exception 'FAIL  a signed-in user read the decrypted view';
exception
  when insufficient_privilege then raise notice '  ok   users BLOCKED from the decrypted view (no grant)';
end $$;
do $$ begin
  perform public.decrypt_api_key('anything');
  raise exception 'FAIL  a signed-in user called decrypt_api_key';
exception
  when insufficient_privilege then raise notice '  ok   users BLOCKED from decrypt_api_key (no grant)';
end $$;
rollback;
