-- ═══════════════════════════════════════════════════════════════════════════
-- 0014 · Module 10 · Storage figures for the admin egress page
-- ═══════════════════════════════════════════════════════════════════════════
-- Actual egress is a Supabase billing metric and is not queryable from inside
-- the database. What *is* queryable is the thing that drives it: how wide each
-- table's rows are and how many of them a query can reach. The old project's
-- bill was not caused by traffic, it was caused by a 6 kB row multiplied by
-- 5,231 rows multiplied by every page view.
--
-- So this returns storage and row counts, and the page is explicit that the
-- authoritative number lives in the Supabase dashboard. A dashboard that
-- implies it is measuring egress when it is measuring table size would be worse
-- than no dashboard.

create or replace function public.admin_table_stats()
returns table (
  table_name   text,
  row_estimate bigint,
  total_bytes  bigint,
  bytes_per_row integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.relname::text,
    greatest(c.reltuples, 0)::bigint,
    pg_total_relation_size(c.oid)::bigint,
    case
      when c.reltuples > 0
        then (pg_total_relation_size(c.oid) / c.reltuples)::integer
      else 0
    end
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
  order by pg_total_relation_size(c.oid) desc
  limit 25;
$$;

comment on function public.admin_table_stats is
  'Per-table storage and row estimates for the admin egress page. '
  'SECURITY DEFINER because pg_class is not readable by the app roles, so the '
  'grant below is the only thing standing in front of it — it must stay '
  'restricted to service_role and be called only after an admin check.';

-- Not reachable from a session token. The admin page calls this through the
-- secret-key client, after has_role('admin') has already been established.
revoke all on function public.admin_table_stats() from public, anon, authenticated;
grant execute on function public.admin_table_stats() to service_role;
