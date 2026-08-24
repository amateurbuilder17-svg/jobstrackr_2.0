-- ═══════════════════════════════════════════════════════════════════════════
-- Development seed
-- ═══════════════════════════════════════════════════════════════════════════
-- Applied by `supabase db reset`. Local only — never runs against a real
-- project. Sized and shaped to resemble production so that pagination, search
-- ranking and deadline logic are exercised honestly rather than on three rows.

insert into public.organizations (slug, name, short_name, aliases, website) values
  ('ssc',      'Staff Selection Commission',                'SSC',    array['Staff Selection Commision','S.S.C.'], 'https://ssc.gov.in'),
  ('upsc',     'Union Public Service Commission',           'UPSC',   array['U.P.S.C.'],                            'https://upsc.gov.in'),
  ('rrb',      'Railway Recruitment Board',                 'RRB',    array['Railway Recruitment Boards'],          'https://indianrailways.gov.in'),
  ('ibps',     'Institute of Banking Personnel Selection',  'IBPS',   array['I.B.P.S.'],                            'https://ibps.in'),
  ('sbi',      'State Bank of India',                       'SBI',    array['S.B.I.'],                              'https://sbi.co.in'),
  ('opsc',     'Odisha Public Service Commission',          'OPSC',   array['Odishā Public Service Commission'],    'https://opsc.gov.in'),
  ('bpsc',     'Bihar Public Service Commission',           'BPSC',   array[]::text[],                              'https://bpsc.bih.nic.in'),
  ('mpsc',     'Maharashtra Public Service Commission',     'MPSC',   array[]::text[],                              'https://mpsc.gov.in'),
  ('drdo',     'Defence Research and Development Organisation', 'DRDO', array['D.R.D.O.'],                          'https://drdo.gov.in'),
  ('isro',     'Indian Space Research Organisation',        'ISRO',   array['I.S.R.O.'],                            'https://isro.gov.in'),
  ('aiims',    'All India Institute of Medical Sciences',   'AIIMS',  array[]::text[],                              'https://aiims.edu'),
  ('ntpc',     'National Thermal Power Corporation',        'NTPC',   array[]::text[],                              'https://ntpc.co.in');

-- ── Jobs ───────────────────────────────────────────────────────────────────
-- 240 rows: enough for 12 pages at the default page size, so deep-page
-- pagination is genuinely exercised rather than assumed.
with orgs as (select id, slug, short_name, row_number() over (order by slug) - 1 as n from public.organizations),
     posts(post, qual, level, minage, maxage, smin, smax) as (values
       ('Combined Graduate Level Examination',        'Bachelor''s degree in any discipline',            'bachelor', 18, 32,  25500,  81100),
       ('Multi Tasking Staff (Non-Technical)',        'Class 10 pass from a recognised board',           'class_10', 18, 27,  18000,  22000),
       ('Junior Engineer (Civil)',                    'Diploma or B.E./B.Tech in Civil Engineering',     'diploma',  18, 32,  35400, 112400),
       ('Assistant Section Officer',                  'Bachelor''s degree in any discipline',            'bachelor', 21, 30,  44900, 142400),
       ('Probationary Officer',                       'Graduate in any discipline',                      'bachelor', 20, 30,  41960,  63840),
       ('Group D Level 1 Posts',                      'Class 10 pass or ITI from a recognised institute','class_10', 18, 33,  18000,  56900),
       ('Scientist / Engineer Grade B',               'B.E./B.Tech in a relevant branch',                'bachelor', 21, 35,  56100, 177500),
       ('Nursing Officer',                            'B.Sc Nursing from a recognised university',       'bachelor', 21, 35,  44900, 142400),
       ('Stenographer Grade C and D',                 'Class 12 pass from a recognised board',           'class_12', 18, 27,  25500,  81100),
       ('Assistant Executive Engineer',               'B.E./B.Tech in the relevant discipline',          'bachelor', 21, 38,  56100, 177500)
     ),
     places(city, st) as (values
       ('New Delhi','Delhi'), ('Bhubaneswar','Odisha'), ('Mumbai','Maharashtra'),
       ('Patna','Bihar'), ('Chennai','Tamil Nadu'), ('All India','All India')
     ),
     rows as (
       select
         i,
         (array(select post from posts))[1 + (i % 10)]  as post,
         (array(select qual from posts))[1 + (i % 10)]  as qual,
         (array(select level from posts))[1 + (i % 10)] as level,
         (array(select minage from posts))[1 + (i % 10)] as minage,
         (array(select maxage from posts))[1 + (i % 10)] as maxage,
         (array(select smin from posts))[1 + (i % 10)]  as smin,
         (array(select smax from posts))[1 + (i % 10)]  as smax,
         (array(select city from places))[1 + (i % 6)]  as city,
         (array(select st from places))[1 + (i % 6)]    as st,
         (select id from orgs where n = i % 12)         as org_id,
         (select lower(short_name) from orgs where n = i % 12) as org_slug,
         2024 + (i % 3)                                  as yr
       from generate_series(1, 240) i
     )
insert into public.jobs (
  slug, title, organization_id, location, state, qualification_summary,
  min_qualification_level, age_min, age_max, salary_min, salary_max,
  vacancies, application_fee, tags, status, is_featured,
  application_start_date, last_date, published_at, dedupe_key, source_url
)
select
  -- Use the slugify() helper rather than an ad-hoc regexp: post names contain
  -- parentheses ("Multi Tasking Staff (Non-Technical)"), which a naive replace
  -- turns into a trailing dash and then a double dash — rejected by the
  -- jobs_slug_format constraint, correctly.
  public.slugify(org_slug || ' ' || post || ' ' || yr || ' ' || i),
  upper(org_slug) || ' ' || post || ' ' || yr,
  org_id, city, st, qual,
  level::public.qualification_level,
  minage, maxage, smin, smax,
  50 + (i * 37) % 18000,
  case when i % 4 = 0 then 0 else 100 end,
  case i % 4
    when 0 then array['graduate','central-govt']
    when 1 then array['class-10','railway']
    when 2 then array['engineering','psu']
    else        array['banking','graduate']
  end,
  'published',
  i % 17 = 0,
  current_date - (((i % 40) + 20)::int),
  -- A spread of deadlines so "closing soon", "closing this month" and
  -- "plenty of time" all have real rows behind them.
  current_date + ((case when i % 11 = 0 then (i % 3) else (i % 95) + 4 end)::int),
  now() - ((i || ' hours')::interval),
  'seed-job-' || i,
  'https://example.gov.in/notification/' || i
from rows;

insert into public.job_details (job_id, description, eligibility_text, apply_link, important_dates, overview)
select
  j.id,
  'The ' || j.title || ' notification has been released. Candidates meeting the eligibility '
    || 'criteria may apply online through the official portal before the last date. '
    || 'Applications submitted after the deadline will not be considered under any circumstances.',
  'Applicants must hold ' || coalesce(j.qualification_summary, 'the prescribed qualification')
    || '. Age relaxation applies as per government norms for SC/ST/OBC/PwD candidates.',
  'https://example.gov.in/apply/' || j.slug,
  jsonb_build_object(
    'application_start', to_char(j.application_start_date, 'YYYY-MM-DD'),
    'application_end',   to_char(j.last_date, 'YYYY-MM-DD')
  ),
  jsonb_build_object('vacancies', j.vacancies, 'mode', 'Online')
from public.jobs j;

-- ── Exams ──────────────────────────────────────────────────────────────────
insert into public.exams (slug, name, short_name, organization_id, description)
select
  'exam-' || o.slug,
  o.name || ' Annual Examination',
  o.short_name,
  o.id,
  'Recruitment examination conducted by ' || o.name || '.'
from public.organizations o;

-- ── Exam updates ───────────────────────────────────────────────────────────
-- Roughly a third link to a job, which is what makes the job_link_state
-- constraint and the unlinked-backlog index worth having.
with j as (select id, slug, title, organization_id, row_number() over (order by slug) - 1 as n from public.jobs limit 180)
insert into public.exam_updates (
  slug, title, category, exam_id, organization_id, job_id, job_link_state,
  summary, tags, published_date, published_at, source_url, dedupe_key, is_published
)
select
  'update-' || j.slug,
  case j.n % 5
    when 0 then 'Admit Card Released for ' || j.title
    when 1 then 'Result Declared for ' || j.title
    when 2 then 'Answer Key Published for ' || j.title
    when 3 then 'Exam Date Announced for ' || j.title
    else        'Notification Update for ' || j.title
  end,
  (array['admit_card','result','answer_key','exam_date','notification'])[1 + (j.n % 5)]::public.update_category,
  (select e.id from public.exams e where e.organization_id = j.organization_id limit 1),
  j.organization_id,
  case when j.n % 3 = 0 then j.id else null end,
  case when j.n % 3 = 0 then 'linked' else 'no_match' end::public.job_link_state,
  'The board has published an update regarding this recruitment. Candidates are advised '
    || 'to download the document from the official website using their registration number.',
  array['update','official'],
  (current_date - ((j.n % 60)::int))::date,
  now() - ((j.n * 3 || ' hours')::interval),
  'https://example.gov.in/update/' || j.n,
  'seed-update-' || j.n,
  true
from j;

insert into public.exam_update_details (exam_update_id, body, sections, download_links)
select
  u.id,
  'Full text of the update. ' || repeat('Candidates should verify their details carefully. ', 20),
  jsonb_build_array(jsonb_build_object('heading','How to download','body','Visit the official portal and log in.')),
  jsonb_build_array(jsonb_build_object('label','Official notification','url','https://example.gov.in/pdf'))
from public.exam_updates u;

-- ANALYZE only: VACUUM cannot run inside the seeding pipeline (SQLSTATE 25001).
-- The VACUUM matters too — a bulk insert leaves each GIN pending list unflushed,
-- which prices the index roughly 76x above its true cost and makes the planner
-- abandon it for a sequential scan (see migration 0009) — so `pnpm db:reset`
-- runs it immediately afterwards.
analyze;
