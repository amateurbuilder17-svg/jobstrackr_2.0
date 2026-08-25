import "server-only";

import { sessionDb } from "../clients";
import { unwrap } from "../errors";
import { EDUCATION_COLUMNS, type EducationRow } from "@/lib/profile/columns";

/**
 * The current user's qualifications.
 *
 * Per-user, so it never caches — the same rule as the saved list and the
 * tracker. RLS scopes it to the owner; the explicit ordering is what the
 * profile page renders and what `stream_of` reads from for matching.
 *
 * Bounded, which the inline version on /profile was not. Nobody has forty
 * degrees, so the limit will never bite — but "every query has a LIMIT" is a
 * habit rather than a threshold, and the one query in the codebase without one
 * is the one that eventually meets a table nobody expected to grow.
 */
export async function listEducation(limit = 20): Promise<EducationRow[]> {
  const db = await sessionDb();

  return unwrap(
    "listEducation",
    await db
      .from("education_qualifications")
      .select(EDUCATION_COLUMNS)
      .order("level", { ascending: false })
      .limit(limit),
  );
}
