#!/usr/bin/env bash
# Regenerates src/lib/db/database.types.ts from the migrations.
#
# Builds them on a throwaway Postgres container rather than reading the live
# project, so this works offline, needs no credentials, and always reflects the
# migrations in the repo instead of whatever state the remote happens to be in.
set -euo pipefail

CONTAINER=jt-schema
DB=types_$$
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/src/lib/db/database.types.ts"

if ! docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=validate \
    -p 55433:5432 pgvector/pgvector:pg17 >/dev/null
  for _ in $(seq 1 40); do
    docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1
  done
fi

docker exec "$CONTAINER" psql -U postgres -q -c "create database $DB;"
trap 'docker exec "$CONTAINER" psql -U postgres -q -c "drop database if exists $DB;" >/dev/null 2>&1' EXIT

docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q \
  < "$ROOT/supabase/.validate/00_supabase_stubs.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 -q < "$f"
done

mkdir -p "$(dirname "$OUT")"
supabase gen types typescript --db-url "postgresql://postgres:validate@127.0.0.1:55433/$DB" > "$OUT"
echo "✓ $(basename "$OUT") — $(wc -l < "$OUT" | tr -d ' ') lines"
