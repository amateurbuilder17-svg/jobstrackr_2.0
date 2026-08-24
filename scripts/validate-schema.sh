#!/usr/bin/env bash
# Applies every migration, in order, to a throwaway Postgres 17 + pgvector
# database. Catches ordering bugs, typos and bad references before anything
# reaches a real project — where a half-applied migration is a genuine mess.
#
#   ./scripts/validate-schema.sh          apply and report
#   ./scripts/validate-schema.sh --keep   leave the database up for poking
set -euo pipefail

CONTAINER=jt-schema
DB=validate_$$
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
  echo "Starting $CONTAINER ..."
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=validate \
    -p 55433:5432 pgvector/pgvector:pg17 >/dev/null
  for _ in $(seq 1 40); do
    docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
  done
fi

psql_db() { docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q "$@"; }

docker exec "$CONTAINER" psql -U postgres -q -c "create database $DB;"
cleanup() {
  if [[ "${1:-}" != "--keep" ]]; then
    docker exec "$CONTAINER" psql -U postgres -q -c "drop database if exists $DB;" >/dev/null 2>&1 || true
  else
    echo "Kept: docker exec -it $CONTAINER psql -U postgres -d $DB"
  fi
}
trap 'cleanup "${1:-}"' EXIT

echo "Applying Supabase stubs ..."
psql_db < "$ROOT/supabase/.validate/00_supabase_stubs.sql"

fail=0
for f in "$ROOT"/supabase/migrations/*.sql; do
  name="$(basename "$f")"
  if psql_db < "$f" 2>/tmp/jt-migrate-err; then
    printf '  \033[32m✓\033[0m %s\n' "$name"
  else
    printf '  \033[31m✗\033[0m %s\n' "$name"
    sed 's/^/      /' /tmp/jt-migrate-err
    fail=1
    break
  fi
done

if [[ $fail -ne 0 ]]; then
  echo
  echo "Schema validation FAILED — nothing was pushed anywhere real."
  exit 1
fi

echo
echo "── Objects created ──"
psql_db -tAc "
  select '  tables    ' || count(*) from pg_tables where schemaname='public'
  union all select '  indexes   ' || count(*) from pg_indexes where schemaname='public'
  union all select '  functions ' || count(*) from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
  union all select '  policies  ' || count(*) from pg_policies where schemaname='public'
  union all select '  RLS off   ' || count(*) from pg_tables t
    join pg_class c on c.relname=t.tablename
    where t.schemaname='public' and not c.relrowsecurity;
"
echo
echo "Schema validates cleanly."
