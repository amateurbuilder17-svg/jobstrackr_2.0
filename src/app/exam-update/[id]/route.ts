import type { NextResponse } from "next/server";

import { publicDb } from "@/lib/db/clients";
import { cachedGone, cachedRedirect } from "@/lib/seo/cached-redirect";

/**
 * `/exam-update/:id` — the old app's second path to an update.
 *
 * A `redirects()` entry cannot express this: the old URL carries a database id
 * and the new one carries a slug, so the mapping needs a lookup. A route
 * handler is the cheapest thing that can do one.
 *
 * Anything that fails to resolve answers 410 Gone, with a link to the updates
 * list for the person holding the old URL. It used to redirect to the list
 * itself, and Google files a crowd of URLs redirecting to one list page as
 * soft 404s. See `cachedGone`.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const { data } = await publicDb()
    .from("exam_updates")
    .select("slug")
    // The old ids were uuids; a slug may also have been used. Try both without
    // letting a malformed value reach Postgres as an invalid uuid literal.
    .or(isUuid(id) ? `id.eq.${id},slug.eq.${id}` : `slug.eq.${id}`)
    .limit(1)
    .maybeSingle();

  return data?.slug ? cachedRedirect(request, `/updates/${data.slug}`) : cachedGone("update");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
