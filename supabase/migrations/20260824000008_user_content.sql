-- ═══════════════════════════════════════════════════════════════════════════
-- 0008 · User-owned content
-- ═══════════════════════════════════════════════════════════════════════════
-- All of this was 0.8 MB in the old project. Small, and completely
-- irreplaceable — it is the only data here that cannot be re-scraped.

create table public.education_qualifications (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,

  level             public.qualification_level not null,
  discipline        text,
  institution       text,
  board_university  text,
  year_of_passing   smallint,
  percentage        numeric(5,2),

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint education_year_sane check (
    year_of_passing is null or year_of_passing between 1950 and extract(year from current_date)::int + 6
  ),
  constraint education_percentage_sane check (
    percentage is null or percentage between 0 and 100
  ),
  -- One row per level per user: nobody holds two different bachelor's records
  -- in this app's model, and duplicates break the "highest qualification" read.
  unique (user_id, level)
);

create index education_user_idx on public.education_qualifications (user_id);
create trigger education_touch_updated_at before update on public.education_qualifications
  for each row execute function public.touch_updated_at();
alter table public.education_qualifications enable row level security;


create table public.saved_jobs (
  user_id   uuid not null references auth.users (id) on delete cascade,
  job_id    uuid not null references public.jobs (id) on delete cascade,
  saved_at  timestamptz not null default now(),
  note      text,
  primary key (user_id, job_id)
);
-- The saved-jobs list orders by saved_at desc for one user.
create index saved_jobs_user_recent_idx on public.saved_jobs (user_id, saved_at desc);
alter table public.saved_jobs enable row level security;


create table public.saved_exam_updates (
  user_id         uuid not null references auth.users (id) on delete cascade,
  exam_update_id  uuid not null references public.exam_updates (id) on delete cascade,
  saved_at        timestamptz not null default now(),
  primary key (user_id, exam_update_id)
);
create index saved_exam_updates_user_recent_idx
  on public.saved_exam_updates (user_id, saved_at desc);
alter table public.saved_exam_updates enable row level security;


-- The tracker: an exam a user is following, plus their own progress on it.
create table public.exam_attempts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  exam_id       uuid references public.exams (id) on delete set null,

  -- Free text so someone can track an exam this app has never heard of. The
  -- alternative is telling a user their exam does not exist, which is absurd.
  custom_name   text,

  stage         text,
  status        text not null default 'tracking',
  applied_at    date,
  exam_date     date,
  result_date   date,
  roll_number   text,
  score         numeric(8,2),
  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint exam_attempts_has_subject check (
    exam_id is not null or nullif(btrim(coalesce(custom_name, '')), '') is not null
  ),
  constraint exam_attempts_status_known check (
    status in ('tracking', 'applied', 'admit_card', 'appeared', 'passed', 'failed', 'withdrawn')
  )
);

create index exam_attempts_user_idx on public.exam_attempts (user_id, exam_date desc nulls last);
create index exam_attempts_exam_idx on public.exam_attempts (exam_id) where exam_id is not null;
create trigger exam_attempts_touch_updated_at before update on public.exam_attempts
  for each row execute function public.touch_updated_at();
alter table public.exam_attempts enable row level security;


create table public.documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,

  kind          text not null,
  label         text,
  -- Storage path, not a URL — the bucket stays swappable.
  storage_path  text not null,
  mime_type     text,
  size_bytes    integer,

  created_at    timestamptz not null default now(),

  constraint documents_size_sane check (size_bytes is null or size_bytes between 0 and 20971520)
);

create index documents_user_idx on public.documents (user_id, created_at desc);
alter table public.documents enable row level security;


create table public.user_calendar_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  exam_id     uuid references public.exams (id) on delete cascade,
  job_id      uuid references public.jobs (id) on delete cascade,

  title       text not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  all_day     boolean not null default true,
  notes       text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint calendar_ends_after_starts check (ends_at is null or ends_at >= starts_at)
);

-- The calendar always queries one user over a date window.
create index user_calendar_events_range_idx
  on public.user_calendar_events (user_id, starts_at);
create trigger user_calendar_events_touch_updated_at before update on public.user_calendar_events
  for each row execute function public.touch_updated_at();
alter table public.user_calendar_events enable row level security;


create table public.notification_preferences (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  telegram_enabled    boolean not null default false,
  email_enabled       boolean not null default false,
  deadline_reminders  boolean not null default true,
  new_job_matches     boolean not null default true,
  exam_updates        boolean not null default true,
  quiet_hours_start   smallint,
  quiet_hours_end     smallint,
  updated_at          timestamptz not null default now(),

  constraint quiet_hours_valid check (
    (quiet_hours_start is null) = (quiet_hours_end is null)
    and (quiet_hours_start is null or quiet_hours_start between 0 and 23)
    and (quiet_hours_end   is null or quiet_hours_end   between 0 and 23)
  )
);
create trigger notification_preferences_touch_updated_at before update on public.notification_preferences
  for each row execute function public.touch_updated_at();
alter table public.notification_preferences enable row level security;


create table public.telegram_connections (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  telegram_id   bigint not null unique,
  username      text,
  linked_at     timestamptz not null default now(),
  is_active     boolean not null default true
);
alter table public.telegram_connections enable row level security;


create table public.suggestions_grievances (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users (id) on delete set null,
  email       text,
  message     text not null,
  status      text not null default 'open',
  created_at  timestamptz not null default now(),

  constraint suggestions_message_length check (length(btrim(message)) between 1 and 2000),
  constraint suggestions_status_known check (status in ('open', 'triaged', 'resolved', 'spam'))
);
create index suggestions_open_idx on public.suggestions_grievances (created_at desc)
  where status = 'open';
alter table public.suggestions_grievances enable row level security;
