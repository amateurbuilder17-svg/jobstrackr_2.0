import "server-only";

import { requireUser } from "@/lib/auth/session";
import { sessionDb } from "@/lib/db/clients";
import { PII_COLUMNS } from "@/lib/profile/pii";

/**
 * The form-filling fields for the current user.
 *
 * `sessionDb` under RLS, so `auth.uid()` scopes it and the query cannot return
 * anybody else's row even if the id were wrong. Never cached — this is one
 * person's identity data, and the "personalisation and caching are a dangerous
 * pair" rule from `saved.ts` applies with more force here than anywhere else in
 * the app.
 *
 * The encrypted columns are not in `PII_COLUMNS` and are not selected anywhere.
 * What comes back for an identity number is the mask.
 */
export async function getPiiProfile(): Promise<Record<string, string | null>> {
  const user = await requireUser("/my-details");
  const db = await sessionDb();

  const { data, error } = await db
    .from("profiles")
    .select(PII_COLUMNS)
    .eq("id", user.id)
    .maybeSingle();

  if (error || !data) return {};

  // Widened to a string map for the renderer, which walks PII_GROUPS by key.
  // Dates arrive as `YYYY-MM-DD` strings and are formatted at the field.
  return data;
}

export interface EducationRowForForms {
  level: string;
  discipline: string | null;
  institution: string | null;
  board_university: string | null;
  year_of_passing: number | null;
  percentage: number | null;
}

/** Education, which forms ask for alongside the personal fields. */
export async function getEducationForForms(): Promise<EducationRowForForms[]> {
  const user = await requireUser("/my-details");
  const db = await sessionDb();

  const { data, error } = await db
    .from("education_qualifications")
    .select("level, discipline, institution, board_university, year_of_passing, percentage")
    .eq("user_id", user.id)
    .order("year_of_passing", { ascending: false });

  if (error) return [];
  return data;
}
