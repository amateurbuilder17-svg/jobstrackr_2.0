-- ═══════════════════════════════════════════════════════════════════════════
-- 0028 · Module 30 · The old matcher's four tiers, brought across
-- ═══════════════════════════════════════════════════════════════════════════
-- M17 shipped two buckets — "you can apply" and "blocked by one thing" — and
-- recorded why the old app's other two were left behind:
--
--   > The skills dimension (stenography, typing, driving) — the old app's
--   > "Skills Gap" bucket. No column records it and no scraper extracts it;
--   > matching on it would be guessing in the one direction this module is not
--   > allowed to guess.
--
-- That was true of the schema and false of the old app. The old matcher did not
-- read a column either: `SKILL_KEYWORDS` in `jobMatcher.ts` was forty-five
-- regexes run over the job's own qualification text, and the scraper had
-- nothing to do with it. The signal was always in the prose we already store.
--
-- So the objection is answerable, and this migration answers it the way 0011
-- answered the stream question: derive it in the database, as a generated
-- column, where it cannot drift from the text it comes from and no ingest path
-- can forget to write it.
--
-- ── What changes, and what does not ────────────────────────────────────────
-- The governing rule is unchanged and is worth restating, because this
-- migration adds two tiers that sit between "yes" and "no" and it would be easy
-- to read them as a relaxation. They are not:
--
--   can_apply   every stated requirement is affirmatively met.
--   skills_gap  every hard requirement is met; the posting also asks for a
--               skill the profile does not claim. The old app's "Almost There".
--   review      no stated requirement is failed, but at least one cannot be
--               *confirmed* — the notification's wording did not parse, or the
--               profile has not answered. The old app's "Worth Checking".
--   blocked     exactly one stated requirement is definitely failed.
--
-- Nothing moves from `blocked` to `can_apply`. What moves is the large set of
-- jobs M17 dropped on the floor: a posting whose qualification line the parser
-- could not read is currently invisible, which is the same silence as "not for
-- you" and is a different fact. `review` is where those go, under their own
-- heading, saying which part could not be read.
--
-- `match_jobs` and `match_jobs_blocked` are left exactly as they are. They are
-- proven by `03_match_proof.sql`, the home page depends on the first, and the
-- proof harness gains an assertion below that this function's `can_apply` tier
-- agrees with `match_jobs` row for row. Two implementations that are asserted
-- to agree are safer than one rewrite that is not.


-- ═══════════════════════════════════════════════════════════════════════════
-- Skills, read out of the posting's own words
-- ═══════════════════════════════════════════════════════════════════════════
-- A direct port of `SKILL_KEYWORDS` from the old `jobMatcher.ts`, in the same
-- order and the same five groups. Two things were changed in the crossing, both
-- deliberate:
--
--   1. Word boundaries. The old patterns were written `\b(steno|stenograph)\b`,
--      which cannot match "stenography" — the trailing `\b` fails against the
--      "y". Roughly a third of the list had this bug. Here the anchor is at the
--      start of the word only where the intent was clearly a prefix.
--
--   2. Surface. The old matcher ran these over title + qualification +
--      eligibility prose. `eligibility_text` lives in `job_details`, which a
--      list query cannot reach by design (0004), so this reads title and
--      `qualification_summary`. Narrower, and narrower is the safe direction.
create or replace function public.skill_tags_of(subject text)
returns text[]
language sql
immutable
strict
set search_path = ''
as $$
  select array_remove(array[
    -- ── Core skills ──────────────────────────────────────────────────────
    case when subject ~* '\m(steno|shorthand)' then 'stenography' end,
    case when subject ~* '\y(computer|ccc|nielit|rscit|ms[\s-]?cit|pgdca|dca|o[\s-]?level|copa|data\s*entry|ms[\s-]?office|tally)\y'
      then 'computer' end,
    case when subject ~* '\yhindi\s*typ|\ymangal\y|typing.*hindi|hindi.*typing'
      then 'typing_hindi' end,
    case when subject ~* '\yenglish\s*typ|\ytypewrit|\ytyping\s*speed|\y[34][05]\s*wpm\y|typing.*english|english.*typing'
      then 'typing_english' end,
    case when subject ~* '\m(driv|lmv|hmv)|motor\s*vehicle' then 'driving' end,
    case when subject ~* '\mswim' then 'swimming' end,
    case when subject ~* '\yphysical\s*(test|fitness|standard|efficien|endurance)|\y\d+\s*(km|meters?)\s*(run|walk)\y|\y(long|high)\s*jump\y|height.*chest'
      then 'physical_fitness' end,
    case when subject ~* '\ybraille\y' then 'braille' end,
    case when subject ~* '\ysign\s*language\y' then 'sign_language' end,
    case when subject ~* '\yrci\s*(regist|recogni)' then 'rci_registration' end,
    case when subject ~* '\yspecial\s*education\y|\y[db]\.?\s*ed\.?\s*spl' then 'special_education' end,

    -- ── Professional certifications ──────────────────────────────────────
    case when subject ~* '\ygate\s*(scor|qualif|rank|valid)|\ygpat\y' then 'gate_score' end,
    case when subject ~* '\y(ugc[\s-]?net|csir[\s-]?net|slet|jrf)\y|\ynet[\s-]qualified\y' then 'net_slet' end,
    case when subject ~* '\y(chartered\s*accountant|icwa|icwai|icmai|icsi|company\s*secretary)\y' then 'ca_icwa' end,
    case when subject ~* '\y(cti|cits)\y|\ycraftsmen?\s*training\y' then 'cti_cits' end,
    case when subject ~* '\y(jaiib|caiib)\y' then 'jaiib_caiib' end,
    case when subject ~* '\y(cfa|frm|prm)\y|\ychartered\s*financial\s*analyst\y|\yfinancial\s*risk\s*manager\y' then 'cfa_frm' end,
    case when subject ~* '\ynism\y' then 'nism' end,
    case when subject ~* '\ypmp\y' then 'pmp' end,
    case when subject ~* '\y(ccna|ccnp|comptia)\y' then 'ccna_networking' end,
    case when subject ~* '\yafih\y' then 'afih' end,
    case when subject ~* '\yboe\y|\yboiler\s*operation\s*engineer\y' then 'boe_certificate' end,
    case when subject ~* '\yfssai\y' then 'fssai' end,
    case when subject ~* '\ynis\s*diploma\y|\ysai\s*ns\s*nis\y' then 'nis_coaching' end,
    case when subject ~* '\ymedical\s*cod|\yicd[\s-]?10\y|\ymedical\s*terminolog' then 'medical_coding' end,

    -- ── Language skills ──────────────────────────────────────────────────
    -- Strict on purpose. A notification that merely mentions Hindi is not
    -- imposing a Hindi requirement, and the old matcher's looser draft of this
    -- pattern tagged half the corpus.
    case when subject ~* '\yproficien\w*\s+in\s+hindi\y|\yhindi\s+(proficien|knowledge|medium)|\yknowledge\s+of\s+hindi\y|\ymust\s+know\s+hindi\y'
      then 'hindi_proficiency' end,
    case when subject ~* '\y(local|regional)\s+language\y|\y(knowledge|proficien\w*|fluent|fluency)\s+(in\s+|of\s+)?(tamil|telugu|kannada|malayalam|bengali|marathi|gujarati|odia|odiya|punjabi|assamese|urdu|konkani|manipuri|meitei|mizo|bodo|dogri|maithili|santali|sindhi|nepali|kashmiri|rajasthani)\y|\y(tamil|telugu|kannada|malayalam|bengali|marathi|gujarati|odia|odiya|punjabi|assamese|urdu|konkani|manipuri|meitei|mizo)\s+(language|medium|proficien|knowledge)\y'
      then 'local_language' end,
    case when subject ~* '\ysanskrit\y' then 'sanskrit' end,

    -- ── Software and technical ───────────────────────────────────────────
    case when subject ~* '\yauto\s*cad\y|\yautocad\y' then 'autocad' end,
    case when subject ~* '\ygis\y|\ygeographic\s*information\s*system\y|\ygeo[\s-]?informatics\y|\yremote\s*sensing\y' then 'gis' end,
    case when subject ~* '\ysap\s*(erp|fico|mm|sd)?\y|\yerp\y' then 'sap_erp' end,
    case when subject ~* '\y(programming|python|javascript)\y|\yjava\y|c\+\+|\ycoding\s+skill' then 'programming' end,

    -- ── Domain expertise ─────────────────────────────────────────────────
    case when subject ~* '\msurvey(or|ing|orship)' then 'surveying' end,
    case when subject ~* '\m(agricultur|agronomy)|\ykrishi\y|\yagri\s*science\y' then 'agriculture' end,
    case when subject ~* '\m(fisher|pisciculture|aquaculture)' then 'fisheries' end,
    case when subject ~* '\m(forestry|forester|sylviculture)' then 'forestry' end,
    case when subject ~* '\mveterinar|\yanimal\s*husbandry\y' then 'veterinary' end,
    case when subject ~* '\mhorticultur' then 'horticulture' end,
    case when subject ~* '\mgeolog' then 'geology' end,
    case when subject ~* '\ytextile\s*(technolog|engineering|science)' then 'textile' end,
    case when subject ~* '\yfood\s*(technolog|science|processing)' then 'food_technology' end,
    case when subject ~* '\mphysiotherap|\y(bpt|mpt)\y' then 'physiotherapy' end,
    case when subject ~* '\yclinical\s*psycholog|\ypsychiatric\s*social\y' then 'clinical_psychology' end,
    case when subject ~* '\ysocial\s*work\y|\y(msw|bsw)\y' then 'social_work' end,
    case when subject ~* '\m(biotechnolog|biomedical)' then 'biotechnology' end,
    case when subject ~* '\ypublic\s*health\y|\ymph\y|\ycommunity\s*medicine\y|\mepidemiolog' then 'public_health' end
  ], null);
$$;

comment on function public.skill_tags_of is
  'Skills a posting asks for, read out of its title and qualification line. A '
  'port of the old app''s SKILL_KEYWORDS, with the word-boundary bug fixed. '
  'Returns the empty array when it recognises nothing, never NULL.';


-- ── Which of those are gates rather than gaps ──────────────────────────────
-- The old matcher split its own list in two and the split is the whole reason
-- the tiers mean anything. Typing at 35 wpm is something a candidate can go and
-- get before the form closes, so a posting asking for it is "almost there".
-- A height and chest standard, a statutory registration, or fluency in a
-- language you do not speak is not, and pretending otherwise sends someone to
-- pay a fee for a test they cannot pass.
--
-- SQL owns this split because SQL decides the tier. The labels live in
-- TypeScript, which is where they are rendered — the same division 0022 made
-- for `blocker_value`.
create or replace function public.blocker_skill_tags()
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array[
    'hindi_proficiency',
    'local_language',
    'sanskrit',
    'physical_fitness',
    'rci_registration'
  ]::text[];
$$;

comment on function public.blocker_skill_tags is
  'Skill tags that are hard gates rather than acquirable gaps. A posting '
  'asking for one of these routes to "verify eligibility", never to "almost '
  'there" — they cannot be acquired between now and the closing date.';


-- ═══════════════════════════════════════════════════════════════════════════
-- Grade, read out of the title
-- ═══════════════════════════════════════════════════════════════════════════
-- A port of `inferGrade`. The old version read title + department; the new
-- schema keeps the body in `organizations`, and a generated column can only see
-- its own row — but every pattern here is a post name, and post names are in
-- the title. "Ministry of Railways" never said Group C; "Junior Clerk" does.
create or replace function public.grade_of(subject text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when subject ~* '\ygroup[\s-]?a\y' then 'Group A'
    when subject ~* '\ygroup[\s-]?b\y' then 'Group B'
    when subject ~* '\ygroup[\s-]?c\y|\y(junior|clerk|ldc|udc)\y|\yssc\s+(chsl|cgl)\y' then 'Group C'
    when subject ~* '\ygroup[\s-]?d\y|\y(mts|peon|safaiwala)\y|\ymulti[\s-]?tasking\y' then 'Group D'
    else null
  end;
$$;

comment on function public.grade_of is
  'The Government of India post classification a title implies, or NULL when '
  'it implies none. NULL is included by the grade filter rather than excluded: '
  'an unclassified post is not evidence of the wrong class.';


-- ═══════════════════════════════════════════════════════════════════════════
-- The columns
-- ═══════════════════════════════════════════════════════════════════════════
-- Generated, for the reason 0011 set out at length: a derived value written by
-- whoever happens to insert is a value some future ingest path forgets, and the
-- failure mode is a feed that silently excludes everything.
--
-- `required_skills` already exists as a plain `text[]` and is left alone. It
-- has never been written by anything — the empty array on all 5,861 rows is
-- what M17 was looking at when it concluded the dimension was unavailable — but
-- converting it in place would mean a hand-written column and a derived one
-- fighting over the same name. This is the derived one; if ingest ever learns
-- to extract structured skills, that is what the other is for.
alter table public.jobs
  add column skill_tags text[]
    generated always as (
      public.skill_tags_of(coalesce(title, '') || ' ' || coalesce(qualification_summary, ''))
    ) stored,
  add column grade text
    generated always as (public.grade_of(coalesce(title, ''))) stored;

comment on column public.jobs.skill_tags is
  'Skills the posting asks for, derived from its title and qualification line. '
  'Generated so it cannot fall out of step with the text, and so no ingest '
  'path has to remember it.';
comment on column public.jobs.grade is
  'Group A/B/C/D, inferred from the title. NULL when the title implies none.';

-- The tier query intersects this against the profile's own skills on every
-- candidate row.
create index jobs_skill_tags_idx on public.jobs using gin (skill_tags);


-- ── The rest of the old wizard, moved server-side ──────────────────────────
-- The old app asked six questions and kept the answers in `localStorage` under
-- `jfy_preferences:<userId>`. That is why its matching had to run in the
-- browser: half the inputs were never on the server. Three of the six already
-- have columns here (date of birth, qualification, preferred sectors and
-- states); these are the other three.
alter table public.profiles
  add column skills text[] not null default '{}',
  add column preferred_grades text[] not null default '{}',
  add column preferred_salary_min integer,
  add column preferred_salary_max integer,
  add constraint profiles_preferred_salary_range check (
    preferred_salary_min is null
    or preferred_salary_max is null
    or preferred_salary_min <= preferred_salary_max
  ),
  add constraint profiles_preferred_salary_sane check (
    (preferred_salary_min is null or preferred_salary_min between 0 and 10000000)
    and (preferred_salary_max is null or preferred_salary_max between 0 and 10000000)
  );

comment on column public.profiles.skills is
  'Skill tags the candidate claims, in the same vocabulary as jobs.skill_tags. '
  'Drives the "almost there" tier: a posting asking for a tag not in here is a '
  'gap, not a match.';
comment on column public.profiles.preferred_grades is
  'Group A/B/C/D the candidate will consider. Empty means no preference. A '
  'posting whose grade could not be inferred is never excluded by this.';


-- ═══════════════════════════════════════════════════════════════════════════
-- match_feed — the whole For You page, in one round trip
-- ═══════════════════════════════════════════════════════════════════════════
-- The old page ran `matchAndSort`, then `hybridRecommend`, then a vector
-- re-rank, then `buildFeed`, all in the browser, over every row in the table.
-- This is the same pipeline with the same signals, evaluated where the indexes
-- are and returned once. The page makes one call and gets its four tiers, its
-- four counters and its shelves' worth of rows from it.
--
-- SECURITY INVOKER (the default), like `match_jobs`: RLS still decides what is
-- visible, and nothing here needs to see a row the caller could not.
--
-- ── Tri-state, everywhere ──────────────────────────────────────────────────
-- Each hard requirement evaluates to TRUE (met), FALSE (definitely failed) or
-- NULL (cannot be confirmed). That third value is the entire difference between
-- this function and `match_jobs`, which collapses NULL into FALSE and drops the
-- row. Here NULL routes to `review` and says which half was unreadable — the
-- notification's wording, or the profile's silence.
create or replace function public.match_feed(p_limit integer default 70)
returns table (
  id                    uuid,
  slug                  text,
  title                 text,
  location              text,
  state                 text,
  last_date             date,
  last_date_display     text,
  vacancies             integer,
  vacancies_display     text,
  qualification_summary text,
  salary_min            integer,
  salary_max            integer,
  salary_display        text,
  application_fee       integer,
  tags                  text[],
  is_featured           boolean,
  published_at          timestamptz,
  organization          jsonb,
  -- 'can_apply' | 'skills_gap' | 'review' | 'blocked'
  tier                  text,
  -- Why it matched, for the card. Ready to render.
  reasons               text[],
  -- What is missing, as `kind:value` codes. The sentence is composed in
  -- TypeScript, which already holds the label for every qualification level and
  -- every skill tag; a second copy of those in SQL is two lists that disagree
  -- the first time one is edited. Same division 0022 made for `blocker_value`.
  gaps                  text[],
  -- How many rows this tier holds in total, before the per-tier cap below.
  -- The counters need the real number and this is a window function over rows
  -- already scanned, not four more queries.
  tier_total            integer
)
language sql
stable
set search_path = ''
as $$
with me as (
  select
    p.id,
    p.gender,
    p.state,
    p.experience_years,
    p.highest_qualification,
    p.preferred_sectors,
    p.preferred_states,
    p.skills,
    p.preferred_grades,
    p.preferred_salary_min,
    p.preferred_salary_max,
    case
      when p.date_of_birth is null then null
      else extract(year from age(current_date, p.date_of_birth))::int
    end as age
  from public.profiles p
  where p.id = (select auth.uid())
),
-- Every stream the candidate holds, at the level they hold it. Their free-text
-- discipline goes through the same parser as the job's requirement, so the two
-- sides cannot drift apart.
my_streams as (
  select public.stream_of(e.discipline) as stream, e.level
  from public.education_qualifications e
  where e.user_id = (select auth.uid())
    and e.discipline is not null
),
-- The old app's strongest ranking signal by a wide margin: a job whose title
-- names an exam you are already preparing for. Withdrawn attempts do not count
-- — that is a decision the candidate already made.
my_exams as (
  select lower(btrim(coalesce(e.name, a.custom_name))) as name,
         lower(btrim(e.short_name)) as short_name
  from public.exam_attempts a
  left join public.exams e on e.id = a.exam_id
  where a.user_id = (select auth.uid())
    and a.status <> 'withdrawn'
    and length(btrim(coalesce(e.name, a.custom_name, ''))) >= 3
),
candidates as (
  select j.*
  from public.jobs j, me
  where j.status = 'published'
    -- Closed notifications are not opportunities.
    and (j.last_date is null or j.last_date >= current_date)

    -- ── Preference filters, which exclude rather than tier ────────────────
    -- These are the old wizard's own hard filters, and they behave the way it
    -- behaved: a job with no stated salary, or no inferable grade, is included.
    -- Absence of information is not evidence of a mismatch, and excluding on it
    -- would hide postings for saying less than their neighbours.
    and (
      (me.preferred_salary_min is null and me.preferred_salary_max is null)
      or (j.salary_min is null and j.salary_max is null)
      or (
        coalesce(j.salary_max, 2147483647) >= coalesce(me.preferred_salary_min, 0)
        and coalesce(j.salary_min, 0) <= coalesce(me.preferred_salary_max, 2147483647)
      )
    )
    and (
      cardinality(me.preferred_grades) = 0
      or j.grade is null
      or j.grade = any (me.preferred_grades)
    )
),
evaluated as (
  select
    c.*,
    me.age as my_age,

    -- ── Age ───────────────────────────────────────────────────────────────
    -- No stated window is not a failure; it is no requirement. An unanswered
    -- date of birth against a stated window is the profile's silence, not the
    -- candidate's ineligibility.
    case
      when c.age_min is null and c.age_max is null then true
      when me.age is null then null
      else (c.age_min is null or me.age >= c.age_min)
       and (c.age_max is null or me.age <= c.age_max)
    end as ok_age,

    -- ── Qualification level ───────────────────────────────────────────────
    case
      when c.min_qualification_level is null then null
      when me.highest_qualification is null then null
      else me.highest_qualification >= c.min_qualification_level
    end as ok_level,

    -- ── Discipline ────────────────────────────────────────────────────────
    -- Unconfirmable in exactly two situations: the notification's wording did
    -- not parse, or the candidate has not named a discipline at all.
    --
    -- A named discipline that `stream_of` does not recognise is NOT one of
    -- them. "History" returns NULL from that parser because the parser only
    -- names specialisations — and a general degree definitely does not satisfy
    -- "B.E./B.Tech in Civil Engineering". The old matcher said the same thing
    -- by defaulting such a degree to its `general` stream and failing it
    -- against any specialised requirement. Treating it as unconfirmable would
    -- put every engineering post in front of every arts graduate under a
    -- heading that says "worth checking", which is the false positive this
    -- module exists to prevent, wearing a hedge.
    case
      when c.required_stream is null then null
      when c.required_stream = 'any' then true
      when not exists (select 1 from my_streams) then null
      else exists (
        select 1 from my_streams ms
        where ms.stream = c.required_stream
          and (
            c.min_qualification_level is null
            or ms.level >= c.min_qualification_level
          )
      )
    end as ok_stream,

    -- ── Gender ────────────────────────────────────────────────────────────
    -- The old matcher called an unstated gender a definite failure against a
    -- women-only post, which tells someone they are ineligible on the strength
    -- of a question they were never asked. It routes to review instead.
    case
      when c.gender = 'any' then true
      when me.gender is null then null
      else c.gender = me.gender
    end as ok_gender,

    -- ── Experience ────────────────────────────────────────────────────────
    -- The old matcher treated experience as a note and never blocked on it,
    -- because its source was prose it could not trust. Both sides are typed
    -- columns here, so it is a real comparison — but an unanswered
    -- `experience_years` is still silence, and silence goes to review.
    case
      when c.experience_years_min is null or c.experience_years_min = 0 then true
      when me.experience_years is null then null
      else me.experience_years >= c.experience_years_min
    end as ok_experience,

    -- ── Skills the posting wants and the profile does not claim ───────────
    (
      select coalesce(array_agg('skill:' || t order by t), '{}')
      from unnest(c.skill_tags) t
      where not (t = any (public.blocker_skill_tags()))
        and not (t = any (me.skills))
    ) as skill_gaps,
    (
      select coalesce(array_agg('gate:' || t order by t), '{}')
      from unnest(c.skill_tags) t
      where t = any (public.blocker_skill_tags())
        and not (t = any (me.skills))
    ) as gate_gaps,

    -- ── Ranking ───────────────────────────────────────────────────────────
    -- The old `scorePriority` and `hybridScorer` weights, summed. Ordering
    -- only: everything reaching a tier has already been placed in it, so no
    -- weight here can move a row between tiers. That is what makes this safe
    -- to tune without re-proving eligibility.
    (
        -- Tracked exam intent (+10). Containment both ways, as the old scorer
        -- did it, plus the short name as a whole word — an exam called "SSC
        -- CGL" appears in titles as "SSC CGL 2026", and as "CGL" alone.
        case when exists (
          select 1 from my_exams x
          where position(x.name in lower(c.title)) > 0
             or position(lower(c.title) in x.name) > 0
             or (
               x.short_name is not null and length(x.short_name) >= 2
               and position(' ' || x.short_name || ' ' in ' ' || lower(c.title) || ' ') > 0
             )
        ) then 10.0 else 0 end
        -- Sector overlap (+5).
      + case when c.tags && me.preferred_sectors then 5.0 else 0 end
        -- Location (+3 preferred or home state, +2 nationwide).
      + case
          when c.state = any (me.preferred_states) then 3.0
          when c.state = me.state then 3.0
          when c.state is null or c.state = 'All India' then 2.0
          else 0
        end
        -- One point per skill the candidate holds that the posting asks for.
      + coalesce((
          select count(*) from unnest(c.skill_tags) t where t = any (me.skills)
        ), 0)::real
        -- Freshly published (+2).
      + case
          when c.published_at is not null and c.published_at >= now() - interval '7 days'
          then 2.0 else 0
        end
        -- Urgency (+2 / +1). The feed's job is to surface what can still be
        -- acted on.
      + case
          when c.last_date is null then 0
          when c.last_date - current_date <= 7 then 2.0
          when c.last_date - current_date <= 15 then 1.0
          else 0
        end
        -- A large recruitment is a materially better chance (+1).
      + case when coalesce(c.vacancies, 0) >= 100 then 1.0 else 0 end
      + case when c.is_featured then 0.5 else 0 end
    )::real as score,

    -- Why this appeared, for the card. A feed that cannot explain itself is
    -- ignored the first time it looks wrong. Built here rather than after the
    -- tier is decided because this is the last CTE where the profile row is in
    -- scope, and a correlated subquery per reason would read it five times.
    array_remove(array[
      case when exists (
        select 1 from my_exams x
        where position(x.name in lower(c.title)) > 0
           or (
             x.short_name is not null and length(x.short_name) >= 2
             and position(' ' || x.short_name || ' ' in ' ' || lower(c.title) || ' ') > 0
           )
      ) then 'Matches an exam you track' end,
      case when c.tags && me.preferred_sectors then 'Matches your sectors' end,
      case
        when c.state = any (me.preferred_states) or c.state = me.state
          then 'In your state'
        when c.state is null or c.state = 'All India' then 'Open all India'
      end,
      case
        when c.last_date is not null and c.last_date - current_date <= 7
        then 'Closing soon'
      end,
      case when coalesce(c.vacancies, 0) >= 100 then 'Large recruitment' end
    ], null) as reasons
  from candidates c, me
),
tiered as (
  select
    e.*,
    case
      -- Definite failures first. Exactly one, as 0022 established: two or more
      -- and the posting is not "close", it is simply not for this person, and
      -- listing it is the noise the old app's "Not Eligible" section became.
      when (e.ok_age is false)::int + (e.ok_level is false)::int
         + (e.ok_stream is false)::int + (e.ok_gender is false)::int
         + (e.ok_experience is false)::int > 1 then null
      when (e.ok_age is false) or (e.ok_level is false) or (e.ok_stream is false)
        or (e.ok_gender is false) or (e.ok_experience is false) then 'blocked'
      -- Then anything unconfirmable, including the non-acquirable gates.
      when e.ok_age is null or e.ok_level is null or e.ok_stream is null
        or e.ok_gender is null or e.ok_experience is null
        or cardinality(e.gate_gaps) > 0 then 'review'
      when cardinality(e.skill_gaps) > 0 then 'skills_gap'
      else 'can_apply'
    end as tier_name
  from evaluated e
),
described as (
  select
    t.*,
    case t.tier_name
      when 'blocked' then array_remove(array[
        case when t.ok_age is false then
          'age:' || coalesce(t.age_min::text, '') || '-' || coalesce(t.age_max::text, '')
                 || '|' || coalesce(t.my_age::text, '') end,
        case when t.ok_level is false then
          'qualification:' || coalesce(t.min_qualification_level::text, '') end,
        case when t.ok_stream is false then
          'stream:' || coalesce(t.required_stream::text, '') end,
        case when t.ok_gender is false then 'gender:' || t.gender::text end,
        case when t.ok_experience is false then
          'experience:' || coalesce(t.experience_years_min::text, '') end
      ], null)
      when 'review' then array_remove(array[
        case when t.ok_age is null then 'unknown:age' end,
        case when t.ok_level is null then
          case when t.min_qualification_level is null
               then 'unstated:level' else 'unknown:level' end end,
        case when t.ok_stream is null then
          case when t.required_stream is null
               then 'unstated:stream' else 'unknown:stream' end end,
        case when t.ok_gender is null then 'unknown:gender' end,
        case when t.ok_experience is null then 'unknown:experience' end
      ], null) || t.gate_gaps
      when 'skills_gap' then t.skill_gaps
      else '{}'::text[]
    end as gaps
  from tiered t
  where t.tier_name is not null
),
ranked as (
  select
    d.*,
    count(*) over (partition by d.tier_name)::int as tier_total,
    row_number() over (
      partition by d.tier_name
      order by d.score desc, d.last_date asc nulls last, d.id desc
    ) as rn
  from described d
)
select
  r.id, r.slug, r.title, r.location, r.state,
  r.last_date, r.last_date_display,
  r.vacancies, r.vacancies_display, r.qualification_summary,
  r.salary_min, r.salary_max, r.salary_display,
  r.application_fee, r.tags, r.is_featured, r.published_at,

  -- Exactly the four fields the card renders, named explicitly so adding a
  -- column to `organizations` cannot silently widen every feed response.
  jsonb_build_object(
    'slug',       o.slug,
    'name',       o.name,
    'short_name', o.short_name,
    'logo_path',  o.logo_path
  ) as organization,

  r.tier_name as tier,
  r.reasons,
  r.gaps,
  r.tier_total

from ranked r
left join public.organizations o on o.id = r.organization_id
-- Per-tier caps, so a candidate with two hundred matches still sees the other
-- three tiers. `can_apply` is the largest because the shelves below it — top
-- matches, closing soon, in your state, large recruitments — all draw from that
-- one pool and deduplicate against each other.
where r.rn <= case r.tier_name
  when 'can_apply'  then 36
  when 'skills_gap' then 12
  when 'review'     then 12
  else 10
end
order by
  case r.tier_name
    when 'can_apply'  then 0
    when 'skills_gap' then 1
    when 'review'     then 2
    else 3
  end,
  r.score desc,
  r.last_date asc nulls last,
  r.id desc
limit least(greatest(p_limit, 1), 70);
$$;

comment on function public.match_feed is
  'The For You page in one round trip: four tiers, their true counts, and the '
  'reasons and gaps each row carries. Hard requirements are tri-state — met, '
  'definitely failed, or unconfirmable — and the third routes to "review" '
  'rather than silently dropping the row, which is the only thing this adds to '
  'match_jobs. Nothing moves from blocked to can_apply. Capped at 70 rows.';

revoke all on function public.match_feed(integer) from public;
grant execute on function public.match_feed(integer) to authenticated;
grant execute on function public.skill_tags_of(text) to authenticated, anon;
grant execute on function public.grade_of(text) to authenticated, anon;
grant execute on function public.blocker_skill_tags() to authenticated, anon;
