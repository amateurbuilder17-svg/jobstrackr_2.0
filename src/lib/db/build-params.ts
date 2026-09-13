import "server-only";

/**
 * Slug lists for `generateStaticParams`, and why they are not the cached ones.
 *
 * `listJobSlugs` and `listExamUpdateSlugs` are `"use cache"` and tagged, which
 * is right for the sitemap and wrong here, for three reasons:
 *
 *   1. These run exactly once per build, so caching them buys nothing.
 *   2. A promise that rejects *inside* a `"use cache"` scope cannot be caught
 *      by the caller — Next fails the build before the catch runs. This is not
 *      hypothetical: `/updates/[slug]` called the cached query directly and
 *      every CI build failed on it with `ENOTFOUND placeholder.supabase.co`,
 *      because CI builds against a deliberately unreachable placeholder host.
 *   3. Cache Components requires the result to contain at least one entry, so
 *      it can validate at build time that the route has no unguarded dynamic
 *      access. Returning an empty array is a hard build error, not a soft
 *      fallback.
 *
 * Hence the sentinel. If the database is unreachable — a blip, a paused
 * project, CI — the build still succeeds with one placeholder slug that renders
 * a 404, and every real page renders on first request and caches from then on.
 * The alternative is a failed deploy because Supabase was briefly slow, which
 * trades a self-healing performance dip for a complete outage.
 */
export const BUILD_SENTINEL_SLUG = "unavailable-at-build-time";

/**
 * How many pages each `generateStaticParams` prerenders.
 *
 * A number, not the whole table, and the reasoning is at
 * `listJobSlugsForBuild` where the egress arithmetic lives. In short:
 * prerendering is a cost decision and discovery is the sitemap's job, so the
 * sitemap queries page to the full corpus and these do not.
 *
 * 100, down from 1,000 in Sep 2026. Three routes call this (`/jobs/[slug]`,
 * `/countdown/[slug]`, `/updates/[slug]`), and every push built a Preview and a
 * Production deployment, so each push prerendered ~6,000 pages: 9–10 minute
 * builds, ISR writes counted per page, and deployment storage that reached 7×
 * the Hobby allowance. A page outside this list still renders on its first
 * request and caches from then on; it just stops costing a render per deploy.
 */
export const BUILD_PRERENDER_LIMIT = 100;

/**
 * Runs a slug query for `generateStaticParams`, degrading to the sentinel
 * rather than throwing.
 *
 * Deliberately not `"use cache"` — see reason 2 above. The `try` is the whole
 * point of the function and must sit outside any cache scope to work.
 */
export async function slugsForBuild(
  label: string,
  run: () => Promise<{ slug: string }[]>,
): Promise<{ slug: string }[]> {
  try {
    const rows = await run();
    if (rows.length > 0) return rows;

    console.warn(`[${label}] No published rows found; prerendering none.`);
  } catch (error) {
    console.warn(
      `[${label}] Database unreachable; prerendering no pages. ` +
        "They will render on first request and cache from then on.",
      error instanceof Error ? error.message : error,
    );
  }

  return [{ slug: BUILD_SENTINEL_SLUG }];
}
