-- ── Ingestion's schedule, in the database it feeds ─────────────────────────
--
-- GET /api/ingest pulls its own window and is idempotent, so a scheduler only
-- has to call it. This makes Supabase Cron that caller: pg_cron fires on its
-- own clock inside Postgres, and pg_net makes the request.
--
-- Chosen after measuring the alternatives. GitHub's scheduler delivered about 6
-- of 45 runs on 2026-09-10; Vercel Hobby crons are daily; the free external
-- cron services hang up at 30 s against runs that take 14–110 s. The GitHub
-- workflow and the daily Vercel cron stay on as second callers.
--
-- ## Three details that decide whether this works
--
-- **The timeout.** pg_net gives up after 2 seconds unless told otherwise, which
-- would cut off every call. It is 300 s here — the route's own maxDuration.
--
-- **The secret never enters git.** The bearer token lives in Vault as
-- `ingest_cron_secret`, written once by hand and read at call time. With no
-- secret the job does nothing, which is also what stops CI's local Supabase —
-- which runs this migration too — from calling production. To set or rotate it:
--
--   select vault.create_secret('<CRON_SECRET>', 'ingest_cron_secret');
--   select vault.update_secret(id, '<CRON_SECRET>')
--     from vault.secrets where name = 'ingest_cron_secret';
--
-- **pg_net's worker can stop silently.** Requests then queue unsent, with no
-- error anywhere, until someone restarts it. So every call first checks the
-- worker and restarts it if it is gone: a failure that needed a person now
-- repairs itself on the next tick. The check can never block the call.
--
-- ## Where the extensions exist
--
-- Everything that needs pg_cron or pg_net sits behind a guard. `prove-schema.sh`
-- replays migrations on a vanilla Postgres that has neither, and there is
-- nothing to schedule there. The two functions are created everywhere: plpgsql
-- resolves `net` and `vault` when it runs, not when it is defined.

create or replace function public.ensure_pg_net_worker()
returns text
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from pg_catalog.pg_stat_activity where backend_type like 'pg_net%worker'
  ) then
    return 'running';
  end if;

  perform net.worker_restart();
  return 'restarted';
exception when others then
  -- Reported, never raised. A guard that can fail its caller turns a missing
  -- worker into a missing ingest, which is the opposite of the point.
  return 'restart failed: ' || sqlerrm;
end;
$$;

comment on function public.ensure_pg_net_worker() is
  'Restarts pg_net''s background worker if it is not running. Called before every '
  'scheduled ingest, because the worker can stop silently and leave requests queued.';

create or replace function public.trigger_ingest()
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  secret text;
  worker text;
begin
  select decrypted_secret into secret
  from vault.decrypted_secrets
  where name = 'ingest_cron_secret';

  if secret is null then
    raise notice 'trigger_ingest: no ingest_cron_secret in Vault, so no call';
    return null;
  end if;

  worker := public.ensure_pg_net_worker();
  if worker <> 'running' then
    raise warning 'trigger_ingest: pg_net worker %', worker;
  end if;

  -- www, never the apex: the apex 308s to www and drops the Authorization header.
  return net.http_get(
    url := 'https://www.jobstrackr.in/api/ingest',
    headers := jsonb_build_object('Authorization', 'Bearer ' || secret),
    timeout_milliseconds := 300000
  );
end;
$$;

comment on function public.trigger_ingest() is
  'Queues one call to GET /api/ingest. Scheduled by pg_cron as the job "ingest"; '
  'reads its bearer token from Vault (ingest_cron_secret) and does nothing without it.';

-- Same lockdown as every other function here. Both live in `public`, which
-- Supabase exposes as RPC — and one of them triggers ingestion.
revoke all on function public.ensure_pg_net_worker() from public, anon, authenticated;
revoke all on function public.trigger_ingest() from public, anon, authenticated;
grant execute on function public.ensure_pg_net_worker() to service_role;
grant execute on function public.trigger_ingest() to service_role;

do $$
begin
  if not (
    exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron')
    and exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_net')
    and pg_catalog.current_setting('shared_preload_libraries') like '%pg_cron%'
  ) then
    raise notice 'pg_cron or pg_net unavailable here; the ingest schedule was not created';
    return;
  end if;

  create extension if not exists pg_net with schema extensions;
  create extension if not exists pg_cron with schema pg_catalog;

  -- Unscheduled by name first, so re-running this updates rather than duplicates.
  perform cron.unschedule(jobid)
  from cron.job
  where jobname in ('ingest', 'cron-run-log-prune');

  -- Off the hour and the half hour, and fifteen minutes from the GitHub
  -- workflow's nominal 7,37, so the two callers interleave instead of colliding.
  perform cron.schedule('ingest', '22,52 * * * *', 'select public.trigger_ingest()');

  -- pg_cron never deletes its own run log. Unpruned, every run is a row forever
  -- — the slow leak `prune_operational_data()` exists to stop everywhere else.
  perform cron.schedule(
    'cron-run-log-prune',
    '17 3 * * *',
    $job$delete from cron.job_run_details where end_time < now() - interval '7 days'$job$
  );
end
$$;
