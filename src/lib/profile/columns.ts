import type { Database } from "@/lib/db/database.types";

/**
 * The columns the profile screens actually render.
 *
 * `select('*')` is banned by lint for the reason this table demonstrates
 * particularly well: `profiles.embedding` is a 384-dimension vector, roughly
 * 6 kB of float text per row once serialised. It is an input to matching in M8
 * and is never displayed, so a wildcard select would ship it to the browser on
 * every profile view for nothing.
 *
 * The string and the `Pick` below list the same columns and must stay in step.
 * Supabase infers the result type from the literal string, so it has to be
 * written out rather than joined from an array — a `.join()` produces `string`,
 * and the inference collapses to `any`.
 */
export const PROFILE_COLUMNS =
  "id, full_name, phone, date_of_birth, gender, category, state, district, highest_qualification, experience_years, preferred_sectors, preferred_states, skills, preferred_grades, preferred_salary_min, preferred_salary_max, onboarding_completed" as const;

export type ProfileRow = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  | "id"
  | "full_name"
  | "phone"
  | "date_of_birth"
  | "gender"
  | "category"
  | "state"
  | "district"
  | "highest_qualification"
  | "experience_years"
  | "preferred_sectors"
  | "preferred_states"
  | "skills"
  | "preferred_grades"
  | "preferred_salary_min"
  | "preferred_salary_max"
  | "onboarding_completed"
>;

/** `user_id` is omitted deliberately: RLS already scopes these to the owner. */
export const EDUCATION_COLUMNS =
  "id, level, discipline, institution, board_university, year_of_passing, percentage" as const;

export type EducationRow = Pick<
  Database["public"]["Tables"]["education_qualifications"]["Row"],
  | "id"
  | "level"
  | "discipline"
  | "institution"
  | "board_university"
  | "year_of_passing"
  | "percentage"
>;
