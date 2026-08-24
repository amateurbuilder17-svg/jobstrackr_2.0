-- Synthetic data at production volume, used by scripts/prove-schema.sh to check
-- that every read path stays on an index. Not a fixture for application tests.
insert into organizations (slug, name, short_name)
select 'org-'||i, 'Organisation '||i, 'ORG'||i from generate_series(1,120) i;

insert into jobs (slug, title, organization_id, location, state, qualification_summary,
                  tags, status, last_date, published_at, vacancies,
                  min_qualification_level, age_min, age_max)
select
  'job-'||i,
  -- A per-row token ('notif<i>') alongside the shared template. Without it
  -- every title is one of four strings, so any search term matches ~25% of the
  -- table and the planner rightly prefers a sequential scan — which would make
  -- an index-usage assertion test the planner's mood rather than the index.
  (array['Staff Selection Commission Combined Graduate Level Examination',
         'Railway Recruitment Board Group D Recruitment',
         'Odishā Public Service Commission Assistant Engineer',
         'Bank of India Probationary Officer Recruitment'])[1+(i%4)]
    || ' ' || (2020+(i%7)) || ' notif' || i,
  o.id,
  (array['New Delhi','Bhubaneswar','Mumbai','Patna'])[1+(i%4)],
  (array['Delhi','Odisha','Maharashtra','Bihar'])[1+(i%4)],
  (array['Bachelor degree in any discipline','Class 12 pass','Diploma in Engineering'])[1+(i%3)],
  case i%3 when 0 then array['ssc','graduate']
           when 1 then array['railway','group-d']
           else        array['psc','engineering'] end,
  'published', current_date + (i%180), now() - (i||' hours')::interval, 10+(i%500),
  (array['bachelor','class_12','diploma'])[1+(i%3)]::qualification_level, 18, 27+(i%8)
from generate_series(1,6000) i
join lateral (select id from organizations offset (i%120) limit 1) o on true;

insert into job_details (job_id, description, eligibility_text, important_dates, raw)
select id, repeat('Detailed notification text for this recruitment. ', 60),
       repeat('Candidates must hold a recognised degree. ', 25),
       jsonb_build_object('apply_start','2026-01-01','apply_end','2026-02-15'),
       jsonb_build_object('scraped', repeat('x', 1200))
from jobs;

-- VACUUM, not just ANALYZE. A bulk insert leaves the GIN index's pending list
-- unflushed, which inflates its estimated startup cost by ~76x (990 -> 13 here)
-- and makes the planner abandon it for a sequential scan. Measured, not
-- theoretical — see prune/ingest notes in 0009 and Module 11.
vacuum analyze;
