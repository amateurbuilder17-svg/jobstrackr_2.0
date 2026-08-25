import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { publicDb } from "../clients";
import { tags } from "../tags";

/**
 * Exam reads for the home page.
 *
 * The ranking comes from `popular_exams`, a SECURITY DEFINER function, because
 * the counts it aggregates live in an RLS-protected table that the anonymous
 * client cannot see a single row of. See migration 0021 for what that function
 * does and does not expose.
 */

export interface PopularExam {
  id: string;
  slug: string;
  name: string;
  short_name: string | null;
  logo_path: string | null;
  next_event_at: string | null;
  next_event_label: string | null;
  tracked: number;
}

export async function listPopularExams(limit = 8): Promise<PopularExam[]> {
  "use cache";
  cacheLife("feed");
  cacheTag(tags.examList());

  // Degrades rather than breaks, and the error is handled here rather than by
  // the caller because a promise that rejects inside a `"use cache"` scope
  // cannot be caught outside it — the same reasoning, and the same failure, as
  // `listJobChanges`.
  //
  // This is one supplementary row on a page whose job is to show open jobs. A
  // missing ranking costs a reader a strip of cards; a throw costs them the
  // entire home page. That is not hypothetical: the first render after this
  // function was created returned "Could not find the function
  // public.popular_exams in the schema cache" — PostgREST had not reloaded —
  // and the whole home page 500ed on it.
  const { data, error } = await publicDb().rpc("popular_exams", { p_limit: limit });

  if (error) {
    console.warn(`[listPopularExams] ${error.message}`);
    return [];
  }

  // `count(*)` comes back as bigint, which PostgREST serialises as a JSON
  // number here; the shape is fixed by the function's own signature.
  return data;
}
