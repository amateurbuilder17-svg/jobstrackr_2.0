#!/usr/bin/env bash
# Production build against the LOCAL Supabase stack.
#
# `next build` runs with NODE_ENV=production, so it loads .env.local and never
# .env.development.local — which means a plain `pnpm build` points at the real
# project. That is the right default, but it makes local verification of the
# static pages impossible until the real project has a schema.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
set -a
# shellcheck disable=SC1091
. ./.env.development.local
set +a
exec pnpm build "$@"
