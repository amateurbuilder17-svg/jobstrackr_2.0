import { NextResponse, type NextRequest } from "next/server";

import {
  normalizeSuggestTerm,
  SUGGEST_MIN_CHARS,
  suggestSubjects,
} from "@/lib/db/queries/attempts";

/**
 * Typeahead for the tracker's add-exam field.
 *
 * ── Why this is a public, cacheable GET ────────────────────────────────────
 * Everything it returns — a notification's title, its conducting body and its
 * closing date — is already on `/jobs` and in the sitemap, so there is nothing
 * here to protect. That matters for cost rather than for convenience: an
 * authenticated route reads cookies, a route that reads cookies cannot be
 * cached by the CDN, and the whole point of this endpoint is that the hundredth
 * person to type "ssc" this hour is served without a function invocation, let
 * alone a Supabase read.
 *
 * Three layers, cheapest first:
 *
 *   1. the browser, which keeps what it has already fetched and narrows it
 *      locally as the user keeps typing (see `attempt-form.tsx`)
 *   2. the CDN, via `s-maxage` below
 *   3. Next's data cache, via `"use cache"` on `suggestSubjects`
 *
 * Only a miss on all three reaches Postgres, and that costs one GIN-indexed
 * lookup returning 24 narrow rows.
 */
export async function GET(request: NextRequest) {
  const term = normalizeSuggestTerm(request.nextUrl.searchParams.get("q") ?? "");

  // Refused here rather than inside the query, so a short term costs no
  // function time and no cache entry either.
  if (term.length < SUGGEST_MIN_CHARS) {
    return NextResponse.json(
      { items: [] },
      { headers: { "Cache-Control": "public, s-maxage=86400" } },
    );
  }

  const items = await suggestSubjects(term);

  return NextResponse.json(
    { items },
    {
      headers: {
        // Long `stale-while-revalidate`: a suggestion list that is an hour
        // behind is still a correct list of real notifications, and the miss
        // is what costs money.
        "Cache-Control": "public, s-maxage=600, stale-while-revalidate=86400",
      },
    },
  );
}
