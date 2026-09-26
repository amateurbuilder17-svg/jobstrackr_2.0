#!/bin/sh
# Vercel's Ignored Build Step, referenced from `ignoreCommand` in vercel.json
# (which caps the inline command at 256 characters, hence a file).
#
# Exit 0 skips the build; any other exit builds.
#
# Why it exists: on the Hobby plan every push built a Preview *and* a
# Production deployment, each prerendering thousands of pages. In Sep 2026
# that reached 73 GB of deployment storage against a 10 GB allowance, and
# most of those pushes only touched scripts/, docs or logo CSVs.

# Previews are not worth their build on this plan.
if [ "$VERCEL_ENV" != "production" ]; then
  echo "Skipping non-production build."
  exit 0
fi

# A redeploy of the commit that is already live always builds. A push always
# brings a new commit, so the same commit as last time means someone asked for
# this deployment — most often to take in an environment variable, which only
# reaches a deployment when it is built. Without this the diff below is empty
# and the redeploy is canceled, which is what happened to both redeploys made
# for the Google Indexing API credentials on 26 Sep 2026.
if [ -n "$VERCEL_GIT_PREVIOUS_SHA" ] && [ "$VERCEL_GIT_PREVIOUS_SHA" = "$VERCEL_GIT_COMMIT_SHA" ]; then
  echo "Redeploy of the live commit: building."
  exit 1
fi

# Compare against the last deployed commit, not HEAD^: a push of several
# commits whose last one is scripts-only must still build. If that commit is
# missing from Vercel's shallow clone, git exits 128 and the build goes ahead,
# which is the safe direction to fail.
git diff --quiet "${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}" HEAD -- \
  src public next.config.ts package.json pnpm-lock.yaml tsconfig.json \
  postcss.config.mjs vercel.json scripts/vercel-ignore-build.sh
