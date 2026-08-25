#!/usr/bin/env bash
# Logical backup of the production database.
#
# Free-tier Supabase has no point-in-time recovery. If a migration goes wrong,
# or a `delete` runs without its `where`, there is nothing to roll back to —
# this script is the whole mitigation, and it only works if it is actually run.
#
# ## Why the Supabase CLI and not plain pg_dump
#
# `pg_dump` refuses to run against a server newer than itself, and Homebrew's
# postgresql@16 against Supabase's Postgres 17 fails outright with "aborting
# because of server version mismatch". The CLI runs pg_dump inside a container
# matching the server, so the version question disappears — and this repo
# already depends on the CLI for `db:reset`, `db:types` and `db:prove`.
#
# ## Why this is a script you run, and not a cron in CI
#
# The obvious move is a scheduled GitHub Action uploading the dump as an
# artifact. It is deliberately not that. The dump contains every user's email,
# phone number and date of birth, and the privacy policy tells those people
# their data sits with Supabase and Vercel. Copying it into a third system on a
# timer would quietly make that untrue. Where these files go is the owner's
# decision, so the script writes one file and stops.
#
# Run it before every migration, and on whatever schedule the data is worth.
#
# ## Usage
#
#   SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@<host>:5432/postgres' \
#     ./scripts/backup.sh [output-dir]
#
# The connection string is in the dashboard under Project Settings → Database →
# Connection string → URI. Use the direct connection, not the transaction
# pooler: pooled connections cannot be dumped. Percent-encode the password if
# it contains any of : / ? # [ ] @.
#
# ## What it captures, and what it does not
#
# Captured: schema and data for `public` and `auth` — the latter explicitly,
# because a default dump takes `public` alone and produces a backup that
# restores all the content and none of the people.
#
# Not captured: Storage objects, and dashboard configuration (auth providers,
# SMTP, redirect URLs). Those are click-path settings; losing them costs an
# afternoon, not the data.
set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "error: SUPABASE_DB_URL is not set. See the header of this file." >&2
  exit 1
fi

if ! command -v supabase >/dev/null 2>&1; then
  echo "error: the Supabase CLI is not installed (brew install supabase/tap/supabase)." >&2
  exit 1
fi

OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$OUT_DIR/jobstrackr-$STAMP.sql.gz"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

SCHEMAS="public,auth"

# Two passes, concatenated in this order. A restore needs the tables to exist
# before the rows arrive, and `supabase db dump` emits one or the other — not
# both — so the ordering is ours to get right.
supabase db dump --db-url "$SUPABASE_DB_URL" --schema "$SCHEMAS" -f "$WORK/schema.sql"
supabase db dump --db-url "$SUPABASE_DB_URL" --schema "$SCHEMAS" --data-only --use-copy \
  -f "$WORK/data.sql"

cat "$WORK/schema.sql" "$WORK/data.sql" | gzip -9 > "$OUT"

# A backup nobody has ever restored is a hypothesis, not a backup. These are the
# smallest checks that catch the two ways this silently produces a useless file:
# a truncated archive, and a dump that connected but read almost nothing.
if ! gzip -t "$OUT" 2>/dev/null; then
  echo "✗ the archive is corrupt — do not rely on it" >&2
  exit 1
fi

TABLES="$(gzip -dc "$OUT" | grep -cE '^CREATE TABLE( IF NOT EXISTS)? ' || true)"
SIZE="$(du -h "$OUT" | cut -f1)"

echo "✓ $OUT ($SIZE)"
echo "✓ archive intact, $TABLES CREATE TABLE statements"

if [[ "$TABLES" -lt 10 ]]; then
  echo "✗ far fewer tables than expected — check the connection string" >&2
  exit 1
fi

# Two traps in one line, both of which produced a false "the accounts are
# missing" against a dump that was perfectly good:
#
#   - The CLI quotes every identifier, so the pattern has to match
#     `"auth"."users"`, not just a bare `auth.users`.
#   - `grep -q` exits on the first match, `gzip` takes SIGPIPE, and under
#     `set -o pipefail` the whole pipeline then reports failure — so a *match*
#     read as a miss. Counting instead of short-circuiting avoids it, which is
#     why the table count above is written the same way.
AUTH_USERS="$(gzip -dc "$OUT" | grep -cE '"?auth"?\."?users"?' || true)"
if [[ "$AUTH_USERS" -eq 0 ]]; then
  echo "✗ no auth.users in the dump — the accounts are not in this backup" >&2
  exit 1
fi
echo "✓ auth.users present"
