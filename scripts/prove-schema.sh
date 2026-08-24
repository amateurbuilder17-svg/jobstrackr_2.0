#!/usr/bin/env bash
# The Module 1 gate. Builds the schema on a throwaway Postgres, then proves:
#   1. every read path stays on an index at production volume
#   2. RLS holds against an anonymous visitor and a hostile signed-in user
# Exits non-zero on any failure.
set -euo pipefail

CONTAINER=jt-schema
DB=prove_$$
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD=validate \
    -p 55433:5432 pgvector/pgvector:pg17 >/dev/null
  for _ in $(seq 1 40); do
    docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1
  done
fi

q() { docker exec -i "$CONTAINER" psql -U postgres -d "$DB" -v ON_ERROR_STOP=1 "$@"; }
docker exec "$CONTAINER" psql -U postgres -q -c "create database $DB;"
trap 'docker exec "$CONTAINER" psql -U postgres -q -c "drop database if exists $DB;" >/dev/null 2>&1' EXIT

q -q < "$ROOT/supabase/.validate/00_supabase_stubs.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do q -q < "$f"; done
echo "Schema built — $(q -tAc "select count(*) from pg_tables where schemaname='public'") tables."

echo
echo "── Row Level Security ──"
q 2>&1 < "$ROOT/supabase/.validate/02_rls_proof.sql" \
  | grep -E "ok|FAIL|ERROR" | sed 's/^NOTICE: */ /'

echo
echo "── Matching: no false eligible ──"
q 2>&1 < "$ROOT/supabase/.validate/03_match_proof.sql" \
  | grep -E "ok|FAIL|ERROR" | sed 's/^NOTICE: */ /'

echo
echo "── Update links: resolved, never guessed ──"
q 2>&1 < "$ROOT/supabase/.validate/04_link_proof.sql" \
  | grep -E "ok|FAIL|ERROR" | sed 's/^NOTICE: */ /'

echo
echo "── Index usage at production volume ──"
q -q < "$ROOT/supabase/.validate/01_seed_proof.sql"

check_plan() {
  local label="$1" want="$2" sql="$3"
  local plan
  plan=$(q -tAc "explain (costs off) $sql" 2>&1)
  if grep -q "$want" <<<"$plan"; then
    echo "  ok   $label — $want"
  else
    echo "  FAIL $label — expected $want, got:"
    sed 's/^/         /' <<<"$plan"
    exit 1
  fi
}

check_plan "feed, page 1"      "Index Scan using jobs_feed_idx" \
  "select id,slug,title from jobs where status='published' order by published_at desc, id desc limit 20"
check_plan "feed, deep page"   "Index Scan using jobs_feed_idx" \
  "select id,slug,title from jobs where status='published' and (published_at,id) < (now()-interval '2000 hours','00000000-0000-0000-0000-000000000000'::uuid) order by published_at desc, id desc limit 20"
# A selective term. For a broad term matching a quarter of the table, a
# sequential scan is the correct plan, so asserting on one would test the
# planner rather than the index.
check_plan "full-text search"  "jobs_search_idx" \
  "select id from jobs where search_vector @@ websearch_to_tsquery('public.jt_search','notif4242')"
check_plan "tag containment"   "jobs_tags_idx" \
  "select id from jobs where tags @> array['railway'] and tags @> array['group-d'] and status='published'"
check_plan "eligibility filter" "jobs_eligibility_idx" \
  "select id from jobs where status='published' and min_qualification_level='diploma' and age_max=34"

echo
echo "── Row width ──"
q -tAc "select '  jobs (hot)  ~' || round(pg_relation_size('jobs')/6000.0) || ' B/row   vs ~6000 B/row in the old schema'"

echo
echo "Module 1 gate: PASSED"
