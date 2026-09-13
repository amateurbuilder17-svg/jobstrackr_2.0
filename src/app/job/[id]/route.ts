import type { NextResponse } from "next/server";

import { publicDb } from "@/lib/db/clients";
import { cachedRedirect } from "@/lib/seo/cached-redirect";

/**
 * `/job/:id` — the old app's singular job route, keyed by database id.
 *
 * Same reasoning as `/exam-update/:id`: the mapping needs a lookup, so it
 * cannot live in `redirects()`. Whether these resolve at all depends on the
 * migration preserving ids; where it does not, the visitor gets the job list
 * instead of a dead end.
 *
 * `closed` resolves too, matching `getJobBySlug`: the detail page answers 200
 * for a closed listing, so sending an indexed legacy URL to the list instead
 * would throw that page away. The response is CDN-cached — see
 * `cachedRedirect` for why that matters on the Hobby plan.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const { data } = await publicDb()
    .from("jobs")
    .select("slug")
    .or(isUuid(id) ? `id.eq.${id},slug.eq.${id}` : `slug.eq.${id}`)
    .in("status", ["published", "closed"])
    .limit(1)
    .maybeSingle();

  return data?.slug
    ? cachedRedirect(request, `/jobs/${data.slug}`, true)
    : cachedRedirect(request, "/jobs", false);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
