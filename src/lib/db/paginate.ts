import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";

import { unwrap } from "./errors";

/**
 * Paging past PostgREST's row cap.
 *
 * ── The bug this exists to fix ─────────────────────────────────────────────
 * Supabase caps every API response at `max_rows` — 1,000 by default, and set
 * to exactly that in `supabase/config.toml`. The cap is applied *server-side,
 * after* the query's own LIMIT, so `.limit(20000)` does not raise it and does
 * not fail: it silently returns the first thousand rows and no indication that
 * there were more.
 *
 * `listJobSlugs` asked for 20,000 and its comment said "about 350 kB across
 * the whole corpus". It was returning 1,000 rows. The production sitemap
 * therefore advertised 1,000 of roughly 5,200 job pages — a four-fifths
 * discovery gap that showed up nowhere, because a truncated sitemap is a valid
 * sitemap. It was found by counting the URLs in the live file and noticing the
 * number was exactly round.
 *
 * ── Why not just raise max_rows ────────────────────────────────────────────
 * Because it is global. Raising it to 20,000 would lift the ceiling on *every*
 * query this app makes, including the ones whose LIMIT is a typo away from
 * being absent — and an accidental 20,000-row read of `jobs` is 30 MB of
 * egress, which is the failure this rebuild exists to recover from. The cap is
 * a backstop worth keeping; the four queries that genuinely need the whole
 * table should say so explicitly, here, and pay for it in pages.
 */

/** Supabase's default, and what `supabase/config.toml` pins. */
export const API_MAX_ROWS = 1000;

/**
 * A hard ceiling on what any one caller may accumulate, independent of the
 * loop's own termination. A paging loop whose exit condition is "a short page"
 * runs forever against a table that keeps growing under it; this is what turns
 * that into a bounded read with a warning.
 */
const DEFAULT_MAX_ROWS = 50_000;

/**
 * Runs `page` repeatedly until it returns a short page, and concatenates.
 *
 * The `page` callback takes a half-open-looking but PostgREST-style *inclusive*
 * range, matching `supabase-js`'s `.range(from, to)` — which sets `offset` and
 * `limit` query parameters, so every request this issues still carries a LIMIT
 * and still satisfies the Module 2 contract test.
 *
 * **Order by something unique.** Offset paging reads the table afresh on each
 * request, so a non-unique sort key lets rows shuffle between pages and be
 * duplicated or skipped. Both callers order by `slug`, which carries a unique
 * constraint.
 */
export async function fetchAllRows<T>(
  operation: string,
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: PostgrestError | null }>,
  options: { pageSize?: number; maxRows?: number } = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? API_MAX_ROWS;
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;

  const rows: T[] = [];

  for (let from = 0; from < maxRows; from += pageSize) {
    const to = Math.min(from + pageSize, maxRows) - 1;
    const batch = unwrap(operation, await page(from, to));

    rows.push(...batch);

    // A page shorter than requested is the end of the table. This is the
    // normal exit; the loop bound above is the safety net, not the mechanism.
    if (batch.length < to - from + 1) return rows;
  }

  // Reaching the ceiling means the caller's assumption about corpus size is
  // stale. Worth a line, because the symptom otherwise is another silently
  // truncated sitemap — the exact bug this module was written for.
  console.warn(
    `[${operation}] stopped at the ${String(maxRows)}-row ceiling; there may be more.`,
  );

  return rows;
}
