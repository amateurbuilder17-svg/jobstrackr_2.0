-- ═══════════════════════════════════════════════════════════════════════════
-- Module 8 proof: match_jobs never says "eligible" when it is not.
-- ═══════════════════════════════════════════════════════════════════════════
-- False negatives are acceptable here and false positives are not, so most of
-- these assertions are about what a candidate must NOT be shown. Every check
-- raises on failure, so the script exits non-zero.
\set ON_ERROR_STOP on

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL  %  — got %, expected %', label, got, want;
  end if;
  raise notice '  ok   %', label;
end $$;

-- ── Four jobs, one per interesting shape ───────────────────────────────────
insert into public.organizations (id, slug, name) values
  ('a0000000-0000-4000-8000-000000000001', 'ssc-m8', 'SSC');

insert into public.jobs
  (id, slug, title, organization_id, status, last_date, published_at,
   qualification_summary, age_min, age_max, gender)
values
  -- Open to any graduate.
  ('b0000000-0000-4000-8000-000000000001', 'open-graduate', 'Open Graduate Post',
   'a0000000-0000-4000-8000-000000000001', 'published', current_date + 30, now(),
   'Bachelor''s degree in any discipline', 21, 30, 'any'),

  -- Engineering only. This is the row that catches level-only matching.
  ('b0000000-0000-4000-8000-000000000002', 'civil-engineer', 'Civil Engineer',
   'a0000000-0000-4000-8000-000000000001', 'published', current_date + 30, now(),
   'Diploma or B.E./B.Tech in Civil Engineering', 21, 32, 'any'),

  -- Nursing only.
  ('b0000000-0000-4000-8000-000000000003', 'staff-nurse', 'Staff Nurse',
   'a0000000-0000-4000-8000-000000000001', 'published', current_date + 30, now(),
   'B.Sc Nursing from a recognised university', 21, 35, 'any'),

  -- School level, and female-only, and closing inside a week.
  ('b0000000-0000-4000-8000-000000000004', 'class10-female', 'Class 10 Post (Female)',
   'a0000000-0000-4000-8000-000000000001', 'published', current_date + 3, now(),
   'Class 10 pass from a recognised board', 18, 27, 'female'),

  -- Wording the parser does not recognise. Must never be matched.
  ('b0000000-0000-4000-8000-000000000005', 'mystery-post', 'Mystery Post',
   'a0000000-0000-4000-8000-000000000001', 'published', current_date + 30, now(),
   'Suitable qualification as decided by the committee', 18, 40, 'any'),

  -- Already closed.
  ('b0000000-0000-4000-8000-000000000006', 'closed-post', 'Closed Post',
   'a0000000-0000-4000-8000-000000000001', 'published', current_date - 1, now(),
   'Bachelor''s degree in any discipline', 18, 40, 'any');

select pg_temp.check('parser: engineering job is tagged engineering',
  (select required_stream::text from public.jobs where slug = 'civil-engineer'),
  'engineering');
select pg_temp.check('parser: "any discipline" is tagged any',
  (select required_stream::text from public.jobs where slug = 'open-graduate'),
  'any');
select pg_temp.check('parser: unrecognised wording stays NULL',
  (select required_stream from public.jobs where slug = 'mystery-post'),
  null::public.qualification_stream);

-- ── The level is derived too, since 0019 ───────────────────────────────────
-- It used to be inserted by hand here, which is exactly why nothing noticed
-- that no writer ever set it in production: the proof supplied the value the
-- application could not.
select pg_temp.check('level: "Bachelor''s degree" reads as bachelor',
  (select min_qualification_level::text from public.jobs where slug = 'open-graduate'),
  'bachelor');
select pg_temp.check('level: "Diploma or B.E." takes the floor, not the ceiling',
  (select min_qualification_level::text from public.jobs where slug = 'civil-engineer'),
  'diploma');
select pg_temp.check('level: "Class 10 pass" reads as class_10',
  (select min_qualification_level::text from public.jobs where slug = 'class10-female'),
  'class_10');
select pg_temp.check('level: unrecognised wording stays NULL',
  (select min_qualification_level from public.jobs where slug = 'mystery-post'),
  null::public.qualification_level);

-- ── Candidates ─────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('c0000000-0000-4000-8000-000000000001', 'arts@example.com'),
  ('c0000000-0000-4000-8000-000000000002', 'civil@example.com'),
  ('c0000000-0000-4000-8000-000000000003', 'school@example.com'),
  ('c0000000-0000-4000-8000-000000000004', 'nodob@example.com'),
  ('c0000000-0000-4000-8000-000000000005', 'toldold@example.com');

-- A B.A. graduate, 25.
update public.profiles set
  full_name = 'Arts Graduate', highest_qualification = 'bachelor',
  date_of_birth = current_date - interval '25 years', gender = 'male',
  state = 'Kerala', preferred_sectors = '{banking}'
  where id = 'c0000000-0000-4000-8000-000000000001';
insert into public.education_qualifications (user_id, level, discipline)
  values ('c0000000-0000-4000-8000-000000000001', 'bachelor', 'History');

-- A civil engineer, 25.
update public.profiles set
  full_name = 'Civil Engineer', highest_qualification = 'bachelor',
  date_of_birth = current_date - interval '25 years', gender = 'male'
  where id = 'c0000000-0000-4000-8000-000000000002';
insert into public.education_qualifications (user_id, level, discipline)
  values ('c0000000-0000-4000-8000-000000000002', 'bachelor', 'Civil Engineering');

-- Class 10 only, 20, female.
update public.profiles set
  full_name = 'School Leaver', highest_qualification = 'class_10',
  date_of_birth = current_date - interval '20 years', gender = 'female'
  where id = 'c0000000-0000-4000-8000-000000000003';

-- A graduate who never entered a date of birth.
update public.profiles set
  full_name = 'No DOB', highest_qualification = 'bachelor', date_of_birth = null
  where id = 'c0000000-0000-4000-8000-000000000004';
insert into public.education_qualifications (user_id, level, discipline)
  values ('c0000000-0000-4000-8000-000000000004', 'bachelor', 'History');

-- A graduate one year past every age ceiling here.
update public.profiles set
  full_name = 'Too Old', highest_qualification = 'bachelor',
  date_of_birth = current_date - interval '41 years'
  where id = 'c0000000-0000-4000-8000-000000000005';
insert into public.education_qualifications (user_id, level, discipline)
  values ('c0000000-0000-4000-8000-000000000005', 'bachelor', 'History');

-- ═══ 1. The arts graduate ══════════════════════════════════════════════════
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000001';

select pg_temp.check('arts grad sees the open graduate post',
  (select count(*)::int from public.match_jobs() where slug = 'open-graduate'), 1);

-- The headline assertion of this module.
select pg_temp.check('arts grad is NOT offered the engineering post',
  (select count(*)::int from public.match_jobs() where slug = 'civil-engineer'), 0);
select pg_temp.check('arts grad is NOT offered the nursing post',
  (select count(*)::int from public.match_jobs() where slug = 'staff-nurse'), 0);
select pg_temp.check('nobody is offered the unparseable post',
  (select count(*)::int from public.match_jobs() where slug = 'mystery-post'), 0);
select pg_temp.check('closed notifications are not offered',
  (select count(*)::int from public.match_jobs() where slug = 'closed-post'), 0);
select pg_temp.check('a male candidate is not offered a female-only post',
  (select count(*)::int from public.match_jobs() where slug = 'class10-female'), 0);

rollback;

-- ═══ 2. The civil engineer ═════════════════════════════════════════════════
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000002';

select pg_temp.check('civil engineer IS offered the engineering post',
  (select count(*)::int from public.match_jobs() where slug = 'civil-engineer'), 1);
select pg_temp.check('civil engineer also sees the open graduate post',
  (select count(*)::int from public.match_jobs() where slug = 'open-graduate'), 1);
select pg_temp.check('civil engineer is NOT offered the nursing post',
  (select count(*)::int from public.match_jobs() where slug = 'staff-nurse'), 0);

rollback;

-- ═══ 3. The school leaver ══════════════════════════════════════════════════
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000003';

select pg_temp.check('school leaver sees the class 10 post',
  (select count(*)::int from public.match_jobs() where slug = 'class10-female'), 1);
select pg_temp.check('school leaver is NOT offered graduate posts',
  (select count(*)::int from public.match_jobs() where slug = 'open-graduate'), 0);
select pg_temp.check('closing within a week is flagged',
  (select 'Closing soon' = any (reasons) from public.match_jobs()
    where slug = 'class10-female'), true);

rollback;

-- ═══ 4. Missing data excludes rather than guesses ══════════════════════════
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000004';

select pg_temp.check('no date of birth means no matches at all',
  (select count(*)::int from public.match_jobs()), 0);

rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000005';

select pg_temp.check('past every age ceiling means no matches',
  (select count(*)::int from public.match_jobs()), 0);

rollback;

-- ═══ 5. Shape of the response ══════════════════════════════════════════════
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000001';

select pg_temp.check('the cap cannot be raised past 50 by the caller',
  (select count(*)::int from public.match_jobs(5000)) <= 50, true);

rollback;


-- ═══ 6. Blocked, and why (Module 17) ═══════════════════════════════════════
-- `match_jobs_blocked` must relax nothing. Every assertion here is either
-- "this names the one thing that failed" or "this is still not offered".
begin;
set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000001';

select pg_temp.check('arts grad sees the engineering post as blocked on stream',
  (select blocker from public.match_jobs_blocked() where slug = 'civil-engineer'),
  'stream');
select pg_temp.check('...and the female-only post as blocked on gender',
  (select blocker from public.match_jobs_blocked() where slug = 'class10-female'),
  'gender');

-- Two failures is not "close", it is simply not for this person.
select pg_temp.check('the unparseable post is not even shown as blocked',
  (select count(*)::int from public.match_jobs_blocked() where slug = 'mystery-post'), 0);
select pg_temp.check('a closed notification is never shown as blocked',
  (select count(*)::int from public.match_jobs_blocked() where slug = 'closed-post'), 0);

-- The set that fails nothing and the set that fails one thing cannot overlap.
select pg_temp.check('nothing is both matched and blocked',
  (select count(*)::int from public.match_jobs() m
     join public.match_jobs_blocked() b on b.id = m.id), 0);

-- Every row explains itself, or the section is worse than not having it.
select pg_temp.check('every blocked row names a blocker',
  (select count(*)::int from public.match_jobs_blocked()
    where blocker is null or blocker = ''), 0);

rollback;

begin;
set local role authenticated;
set local request.jwt.claim.sub = 'c0000000-0000-4000-8000-000000000005';

select pg_temp.check('the 41-year-old is blocked on age, not silently dropped',
  (select blocker from public.match_jobs_blocked() where slug = 'open-graduate'),
  'age');

rollback;
