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
with orgs as (select id, slug, short_name, website, row_number() over (order by slug) - 1 as n from public.organizations),
     -- `level` is gone from this list on purpose: min_qualification_level is a
     -- generated column since 0019, derived from the qualification line to its
     -- left. The ten strings below produce bachelor / class_10 / diploma /
     -- class_12 between them, which is exactly what used to be hand-written
     -- here — and now cannot drift from the text it claims to describe.
     posts(post, qual, minage, maxage, smin, smax) as (values
       ('Combined Graduate Level Examination',        'Bachelor''s degree in any discipline',            18, 32,  25500,  81100),
       ('Multi Tasking Staff (Non-Technical)',        'Class 10 pass from a recognised board',           18, 27,  18000,  22000),
       ('Junior Engineer (Civil)',                    'Diploma or B.E./B.Tech in Civil Engineering',     18, 32,  35400, 112400),
       ('Assistant Section Officer',                  'Bachelor''s degree in any discipline',            21, 30,  44900, 142400),
       ('Probationary Officer',                       'Graduate in any discipline',                      20, 30,  41960,  63840),
       ('Group D Level 1 Posts',                      'Class 10 pass or ITI from a recognised institute',18, 33,  18000,  56900),
       ('Scientist / Engineer Grade B',               'B.E./B.Tech in a relevant branch',                21, 35,  56100, 177500),
       ('Nursing Officer',                            'B.Sc Nursing from a recognised university',       21, 35,  44900, 142400),
       ('Stenographer Grade C and D',                 'Class 12 pass from a recognised board',           18, 27,  25500,  81100),
       ('Assistant Executive Engineer',               'B.E./B.Tech in the relevant discipline',          21, 38,  56100, 177500)
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
         (array(select minage from posts))[1 + (i % 10)] as minage,
         (array(select maxage from posts))[1 + (i % 10)] as maxage,
         (array(select smin from posts))[1 + (i % 10)]  as smin,
         (array(select smax from posts))[1 + (i % 10)]  as smax,
         (array(select city from places))[1 + (i % 6)]  as city,
         (array(select st from places))[1 + (i % 6)]    as st,
         (select id from orgs where n = i % 12)         as org_id,
         (select lower(short_name) from orgs where n = i % 12) as org_slug,
         -- The body's genuine site, so no row on a job page points at a
         -- placeholder domain. See the note above `exam_updates`.
         (select website from orgs where n = i % 12)    as org_site,
         2024 + (i % 3)                                  as yr
       from generate_series(1, 240) i
     )
insert into public.jobs (
  slug, title, organization_id, location, state, qualification_summary,
  age_min, age_max, salary_min, salary_max,
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
  org_site
from rows;

-- ── Job details — the cold half ────────────────────────────────────────────
-- Every column the detail page renders, because a seed that only fills three of
-- them cannot tell you whether the other eight render correctly. This is the
-- shape `toJobDetailPayload` writes: dates as an array of {event, date}, fees
-- as {category, fee}, the vacancy table as {columns, rows}, steps as strings.
insert into public.job_details (
  job_id, description, eligibility_text, experience_text,
  salary_text, age_limit_text,
  apply_link, official_website, notification_pdf,
  important_dates, application_fees, vacancies_detail, selection_process, overview
)
select
  j.id,
  'The ' || j.title || ' notification has been released. Candidates meeting the eligibility '
    || 'criteria may apply online through the official portal before the last date. '
    || 'Applications submitted after the deadline will not be considered under any circumstances.',
  'Applicants must hold ' || coalesce(j.qualification_summary, 'the prescribed qualification')
    || '. Age relaxation applies as per government norms for SC/ST/OBC/PwD candidates.',
  case when j.id::text like '%1' then 'Two years of relevant experience in a government or PSU establishment.' end,
  'Pay Level ' || (4 + (length(j.title) % 6)) || ' of the 7th CPC pay matrix — ₹'
    || to_char(j.salary_min, 'FM9,99,999') || ' to ₹' || to_char(j.salary_max, 'FM9,99,999')
    || ', plus Dearness Allowance, House Rent Allowance and Transport Allowance as admissible.',
  'Minimum ' || j.age_min || ' years and maximum ' || j.age_max || ' years as on the closing date. '
    || 'Upper age relaxation: OBC 3 years, SC/ST 5 years, PwD 10 years, ex-servicemen as per rules.',
  -- All three are the department's real site. A fabricated path on a real
  -- domain ("aiims.edu/notice/x.pdf") would be worse than the placeholder it
  -- replaces: it looks genuine and 404s, so nobody reviewing a page can tell
  -- a seeded link from a scraped one that has rotted.
  o.website,
  o.website,
  -- Left null on about a quarter of rows. `notification_pdf` is null on plenty
  -- of production rows, and with it set on every row the job page's "no
  -- documents" branch never renders in development.
  case when j.id::text < 'c' then o.website end,
  jsonb_build_array(
    jsonb_build_object('event', 'Application Start', 'date', to_char(j.application_start_date, 'DD Mon YYYY')),
    jsonb_build_object('event', 'Last Date to Apply', 'date', to_char(j.last_date, 'DD Mon YYYY')),
    jsonb_build_object('event', 'Last Date for Fee Payment', 'date', to_char(j.last_date, 'DD Mon YYYY')),
    jsonb_build_object('event', 'Admit Card', 'date', 'Two weeks before the exam'),
    jsonb_build_object('event', 'Exam Date', 'date', to_char(j.last_date + 45, 'DD Mon YYYY'))
  ),
  jsonb_build_array(
    jsonb_build_object('category', 'General / OBC / EWS', 'fee',
      case when j.application_fee = 0 then 'Nil' else '₹' || j.application_fee end),
    jsonb_build_object('category', 'SC / ST / PwD', 'fee', 'Nil'),
    jsonb_build_object('category', 'Women (all categories)', 'fee', 'Nil')
  ),
  jsonb_build_object(
    'columns', jsonb_build_array('Post', 'UR', 'OBC', 'SC', 'ST', 'EWS', 'Total'),
    'rows', jsonb_build_array(
      jsonb_build_array(j.title, (j.vacancies / 2)::text, (j.vacancies / 5)::text,
                        (j.vacancies / 8)::text, (j.vacancies / 12)::text,
                        (j.vacancies / 10)::text, j.vacancies::text)
    )
  ),
  jsonb_build_array(
    'Computer Based Test (Tier I)',
    'Descriptive Paper (Tier II)',
    'Skill Test / Typing Test, where applicable',
    'Document Verification',
    'Medical Examination'
  ),
  jsonb_build_object(
    'conducting_body', coalesce(o.name, 'Government of India'),
    'mode_of_application', 'Online',
    'job_location', coalesce(j.location, 'All India'),
    -- Null when a job has no organisation, which renders as no row at all.
    -- Substituting a generic portal here would assert it as *this* recruitment's
    -- official site, which is the kind of plausible-but-wrong link this seed is
    -- being cleaned of.
    'official_website', o.website
  )
from public.jobs j
left join public.organizations o on o.id = j.organization_id;

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
--
-- Every URL on an update page comes from `organizations.website`, which holds
-- the body's genuine official site — ssc.gov.in, upsc.gov.in, aiims.edu. These
-- rows used to point at `example.gov.in`, and a placeholder domain is the one
-- thing a link on this page must never be: the page's whole purpose is to hand
-- the reader an official address, so a fake one there is indistinguishable from
-- the aggregator spam `links.ts` exists to strip.
with j as (
  select
    job.id, job.slug, job.title, job.organization_id,
    org.website,
    row_number() over (order by job.slug) - 1 as n
  from public.jobs job
  join public.organizations org on org.id = job.organization_id
  limit 180
)
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
  j.website,
  'seed-update-' || j.n,
  true
from j;

-- The detail blobs, in the shapes production actually stores.
--
-- This used to be one section, one link, and nothing else — no `important_dates`,
-- no `overview`. So every update page in local dev rendered a title, a summary
-- and one collapsed panel, which is a fair description of a broken page and no
-- description at all of the real one. Worse, the three shapes that make
-- `detail-shape.ts` necessary were all absent, so a change that broke them
-- looked fine here and only failed against the real table:
--
--   • `sections` store `content: string[]`, not `body: string` (998 of 1,000
--     sampled rows), and carry the source site's own adverts inline;
--   • `important_dates` is a scraped table with its header row still in it, and
--     on ~28% of rows it is a *links* table wearing a date table's clothes;
--   • the dates those rows are missing live in `overview` instead.
--
-- Every third seeded row therefore gets the link-table shape rather than a real
-- date table, which is what exercises the promotion path in `datesFromOverview`.
insert into public.exam_update_details
  (exam_update_id, body, sections, overview, important_dates, download_links, related_articles)
select
  u.id,
  'Full text of the update. ' || repeat('Candidates should verify their details carefully. ', 20),
  jsonb_build_array(
    jsonb_build_object(
      'heading', u.title || ' - Overview',
      'type', 'paragraph',
      'content', jsonb_build_array(
        'The board has released this notice on its official portal.',
        -- The advert `toUpdateSections` has to drop. Without one in the seed,
        -- a regression in that filter is invisible locally.
        '⚡ Get Custom Govt Job Alerts by Your Qualification (10TH | 12TH | Diploma)'
      )
    ),
    jsonb_build_object(
      'heading', 'How to download',
      'type', 'list',
      'content', jsonb_build_array(
        'Visit the official portal and log in.',
        'Enter your registration number and date of birth.',
        'Download the PDF and take a printout for the exam hall.'
      )
    ),
    -- A heading whose lines are all adverts: dropped entirely, rather than
    -- rendered as an empty panel.
    jsonb_build_object(
      'heading', 'Stay updated',
      'type', 'paragraph',
      'content', jsonb_build_array('Join our WhatsApp channel for instant alerts')
    )
  ),
  jsonb_build_array(
    -- The header row the scraper takes for data, on the largest source.
    jsonb_build_object('field','Detail','value','Information'),
    jsonb_build_object('field','Recruiting Body','value', o.name),
    jsonb_build_object('field','Post Name','value', u.title),
    jsonb_build_object('field','Total Vacancies','value','120'),
    jsonb_build_object('field','Qualification','value','Graduate in any discipline'),
    jsonb_build_object('field','Apply Mode','value','Online'),
    -- Present on 3,539 production rows, and the reason a bare domain has to be
    -- readable as a value here while `inferLinkLabel` refuses it as a *label*.
    jsonb_build_object('field','Official Website','value', o.website),
    -- A date hiding in the overview table. On rows with no date table of their
    -- own this is the only schedule the page can show.
    jsonb_build_object('field','Exam Date','value', to_char(current_date + 21, 'DD Month YYYY'))
  ),
  case when u.id::text < '5'
    then jsonb_build_array(
      -- A links table stored in the dates column: every row is dropped from the
      -- schedule, and the URLs are rescued into Important links instead.
      jsonb_build_object('event','Link Description','date','Link','status','','link',''),
      jsonb_build_object('event','Official Website','date','Click here','status','',
                         'link', o.website)
    )
    else jsonb_build_array(
      jsonb_build_object('event','Event','date','Date','status','','link',''),
      jsonb_build_object('event','Application Start Date',
                         'date', to_char(current_date - 30, 'DD-MM-YYYY'), 'status','Closed','link',''),
      jsonb_build_object('event','Last Date to Apply',
                         'date', to_char(current_date + 7, 'DD-MM-YYYY'), 'status','Active','link',''),
      -- An over-long cell, so the note split in `splitDateNote` is exercised.
      jsonb_build_object('event','Admit Card Release Date',
                         'date', to_char(current_date + 14, 'DD-MM-YYYY')
                                 || ' (tentative; subject to change as per the board notice)',
                         'status','','link','')
    )
  end,
  jsonb_build_array(
    -- Labelled "Click here" by the source, as most stored links are. On the
    -- link-table rows above, the date table names this same URL "Official
    -- Website", so the two merge and the label that says something wins; on the
    -- rest it falls through to `inferLinkLabel`, which reads a URL with no path
    -- as "Official website".
    jsonb_build_object('label','Click here','url', o.website),
    -- A blocked destination that predates the ingest blocklist. It must never
    -- reach the page.
    jsonb_build_object('label','Join our channel','url','https://t.me/examalerts')
  ),
  -- Empty on every production row sampled. Seeding a second fabricated address
  -- to fill the section would put the one thing on this page that must be real
  -- — an official link — behind a domain that is not.
  '[]'::jsonb
from public.exam_updates u
join public.organizations o on o.id = u.organization_id;

-- ── Operational rows, so the admin monitor has something to show ─────────
-- Module 11 writes these for real. Seeded here because an ingest monitor with
-- no runs in it cannot be reviewed, and a dead-letter list that is always empty
-- never gets its rendering checked.

insert into public.scraper_sources (name, url, category, limit_per_run, last_scraped_at)
values
  ('SSC notices',  'https://ssc.gov.in/notices',  'notification', 6, now() - interval '2 hours'),
  ('RRB results',  'https://rrb.gov.in/results',  'result',       6, now() - interval '5 hours'),
  ('UPSC admit',   'https://upsc.gov.in/admit',   'admit_card',   4, now() - interval '1 day');

insert into public.sync_runs
  (kind, status, rows_seen, rows_inserted, rows_updated, rows_unchanged, rows_failed,
   started_at, finished_at, duration_ms, error)
select
  kind, status, seen, ins, upd, unchanged, failed,
  now() - (n || ' hours')::interval,
  now() - (n || ' hours')::interval + (ms || ' milliseconds')::interval,
  ms, err
from (values
  (1,  'jobs',         'succeeded'::public.sync_status, 240, 0,  4,   236, 0, 4120,  null),
  (2,  'exam_updates', 'succeeded'::public.sync_status, 180, 2,  1,   177, 0, 3080,  null),
  (5,  'jobs',         'succeeded'::public.sync_status, 240, 0,  0,   240, 0, 2950,  null),
  (9,  'exam_updates', 'partial'::public.sync_status,   180, 1,  0,   177, 2, 5210,  '2 rows failed to parse'),
  (14, 'embeddings',   'succeeded'::public.sync_status,  60, 60, 0,   0,   0, 18400, null),
  (26, 'jobs',         'failed'::public.sync_status,      0, 0,  0,   0,   0, 900,   'Apps Script feed returned 502')
) as t(n, kind, status, seen, ins, upd, unchanged, failed, ms, err);

insert into public.sync_dead_letter (kind, source_key, payload, error, attempts)
values
  ('exam_updates', 'rrb-group-d-result-2026',
   '{"title":"RRB Group D Result 2026","raw":"…"}'::jsonb,
   'published_date could not be parsed from "Coming Soon"', 3),
  ('exam_updates', 'ssc-chsl-answer-key',
   '{"title":"SSC CHSL Answer Key","raw":"…"}'::jsonb,
   'source_url returned 404 after 3 attempts', 3);

-- ANALYZE only: VACUUM cannot run inside the seeding pipeline (SQLSTATE 25001).
-- The VACUUM matters too — a bulk insert leaves each GIN pending list unflushed,
-- which prices the index roughly 76x above its true cost and makes the planner
-- abandon it for a sequential scan (see migration 0009) — so `pnpm db:reset`
-- runs it immediately afterwards.
analyze;

-- ── A sign-in ──────────────────────────────────────────────────────────────
-- `supabase db reset` empties `auth.users` along with everything else, and
-- nothing here put anybody back — so every reset left the local app with a
-- login screen and no account that could pass it. Signing up again works, but
-- only over the mail flow, and this project's local stack points SMTP at a
-- real Resend key rather than at Mailpit; the recovery and confirmation mail
-- it sends goes to a real inbox, which is a slow and surprising way to get
-- back into a development database.
--
-- So the seed provides one account, the same way it provides jobs and exams.
-- Local only: this file is never applied to a hosted project, the password is
-- written here in the open precisely because it is worthless, and the id is a
-- fixed UUID so a reset lands on the same profile row every time.
--
--     dev@local.test / localdev1234
--
-- `handle_new_user` fires on the insert below and creates the `profiles` row,
-- so this exercises the same trigger a real signup does rather than reaching
-- around it.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  -- Empty strings, not NULL. GoTrue scans these four into plain Go strings, so
  -- a NULL is not an absent token but a failed scan: every sign-in for this
  -- user comes back `500 Database error querying schema`, which names the
  -- schema and not the row that is actually wrong. Its own signup path writes
  -- '' here, so this matches what a real account looks like.
  confirmation_token, recovery_token, email_change, email_change_token_new
) values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'dev@local.test',
  -- Hashed rather than written as a hash, so the cost factor is whatever this
  -- Postgres thinks is current and the literal above stays readable.
  extensions.crypt('localdev1234', extensions.gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  '', '', '', ''
);

-- GoTrue checks `auth.users` for the password grant, but the account is only
-- coherent — linkable, listable in Studio, correct in the admin API — once the
-- provider it signed up with is recorded beside it.
insert into auth.identities (
  provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
) values (
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000001',
  jsonb_build_object(
    'sub', '00000000-0000-4000-8000-000000000001',
    'email', 'dev@local.test',
    'email_verified', true,
    'phone_verified', false
  ),
  'email',
  now(), now(), now()
);
