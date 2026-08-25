import { redirect, permanentRedirect } from "next/navigation";

import { publicDb } from "@/lib/db/clients";

/**
 * `/exam-update/:id` — the old app's second path to an update.
 *
 * A `redirects()` entry cannot express this: the old URL carries a database id
 * and the new one carries a slug, so the mapping needs a lookup. A route
 * handler is the cheapest thing that can do one.
 *
 * Anything that fails to resolve lands on the updates list rather than a 404.
 * These URLs are in Google's index and in people's messages; a list page is a
 * worse answer than the right article and a much better one than nothing.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data } = await publicDb()
    .from("exam_updates")
    .select("slug")
    // The old ids were uuids; a slug may also have been used. Try both without
    // letting a malformed value reach Postgres as an invalid uuid literal.
    .or(isUuid(id) ? `id.eq.${id},slug.eq.${id}` : `slug.eq.${id}`)
    .limit(1)
    .maybeSingle();

  if (data?.slug) permanentRedirect(`/updates/${data.slug}`);
  redirect("/updates");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
