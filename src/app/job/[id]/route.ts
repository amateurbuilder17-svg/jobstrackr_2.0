import { redirect, permanentRedirect } from "next/navigation";

import { publicDb } from "@/lib/db/clients";

/**
 * `/job/:id` — the old app's singular job route, keyed by database id.
 *
 * Same reasoning as `/exam-update/:id`: the mapping needs a lookup, so it
 * cannot live in `redirects()`. Whether these resolve at all depends on the
 * migration preserving ids; where it does not, the visitor gets the job list
 * instead of a dead end.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const { data } = await publicDb()
    .from("jobs")
    .select("slug")
    .or(isUuid(id) ? `id.eq.${id},slug.eq.${id}` : `slug.eq.${id}`)
    .eq("status", "published")
    .limit(1)
    .maybeSingle();

  if (data?.slug) permanentRedirect(`/jobs/${data.slug}`);
  redirect("/jobs");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
