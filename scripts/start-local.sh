#!/usr/bin/env bash
# Production server against the LOCAL Supabase stack.
#
# The sibling of build-local.sh, and it exists for the same reason: `next start`
# runs with NODE_ENV=production and therefore loads .env.local, which points at
# the real project. Verifying the statically generated pages against seeded data
# needs the local stack at runtime as well as at build time.
#
# Build first with `pnpm build:local`, or the two will disagree about which
# database the prerendered HTML came from.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
set -a
# shellcheck disable=SC1091
. ./.env.development.local
set +a
exec pnpm start "$@"
