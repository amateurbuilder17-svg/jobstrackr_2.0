"use server";

import { revalidatePath } from "next/cache";

import { type FormState } from "@/lib/auth/form-state";
import { educationSchema, fieldErrors, profileSchema } from "@/lib/auth/schemas";
import { getUser } from "@/lib/auth/session";
import { sessionDb } from "@/lib/db/clients";

/**
 * Profile writes.
 *
 * Two layers of protection, and both are load-bearing. Each action re-reads the
 * user from the verified session and scopes its write to that id, so a
 * tampered form field cannot address someone else's row. Underneath, the RLS
 * policies (`profiles_owner_update`, `education_owner_all`) refuse the write
 * outright even if this file were wrong. The `.eq()` calls are not redundant
 * with RLS — they turn a policy violation into a no-op with a clear owner,
 * which is easier to reason about than a database error surfacing in a form.
 */

export async function updateProfileAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getUser();
  if (!user) return { ok: false, errors: { form: "Your session has expired." } };

  const parsed = profileSchema.safeParse({
    fullName: formData.get("fullName"),
    phone: formData.get("phone"),
    dateOfBirth: formData.get("dateOfBirth"),
    gender: emptyToNull(formData.get("gender")),
    category: emptyToNull(formData.get("category")),
    state: formData.get("state"),
    district: formData.get("district"),
    highestQualification: emptyToNull(formData.get("highestQualification")),
    experienceYears: formData.get("experienceYears"),
    // getAll, because a multi-select posts one entry per selection and `get`
    // would silently keep only the first.
    preferredSectors: formData.getAll("preferredSectors"),
    preferredStates: formData.getAll("preferredStates"),
  });

  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const p = parsed.data;

  const db = await sessionDb();
  const { error } = await db
    .from("profiles")
    .update({
      full_name: p.fullName,
      phone: p.phone,
      date_of_birth: p.dateOfBirth,
      gender: p.gender,
      category: p.category,
      state: p.state,
      district: p.district,
      highest_qualification: p.highestQualification,
      experience_years: p.experienceYears,
      preferred_sectors: p.preferredSectors,
      preferred_states: p.preferredStates,
      // Completing the form is what ends onboarding. Never set back to false:
      // clearing an optional field later is editing, not un-onboarding.
      onboarding_completed: true,
    })
    .eq("id", user.id);

  if (error) return { ok: false, errors: { form: error.message } };

  revalidatePath("/profile");
  return { ok: true, message: "Profile saved." };
}

export async function upsertEducationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getUser();
  if (!user) return { ok: false, errors: { form: "Your session has expired." } };

  const parsed = educationSchema.safeParse({
    level: formData.get("level"),
    discipline: formData.get("discipline"),
    institution: formData.get("institution"),
    boardUniversity: formData.get("boardUniversity"),
    yearOfPassing: formData.get("yearOfPassing"),
    percentage: formData.get("percentage"),
  });

  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const e = parsed.data;

  const db = await sessionDb();
  const { error } = await db.from("education_qualifications").upsert(
    {
      user_id: user.id,
      level: e.level,
      discipline: e.discipline,
      institution: e.institution,
      board_university: e.boardUniversity,
      year_of_passing: e.yearOfPassing,
      percentage: e.percentage,
    },
    // Matches the `unique (user_id, level)` constraint, so re-submitting a
    // level edits that record rather than failing on the duplicate.
    { onConflict: "user_id,level" },
  );

  if (error) return { ok: false, errors: { form: error.message } };

  revalidatePath("/profile");
  return { ok: true, message: "Qualification saved." };
}

export async function deleteEducationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getUser();
  if (!user) return { ok: false, errors: { form: "Your session has expired." } };

  const id = formData.get("id");
  if (typeof id !== "string" || id === "") {
    return { ok: false, errors: { form: "Nothing to remove." } };
  }

  const db = await sessionDb();
  const { error } = await db
    .from("education_qualifications")
    .delete()
    .eq("id", id)
    // The row id alone would be enough for RLS to refuse someone else's record,
    // but scoping by owner as well means a wrong id deletes nothing rather than
    // returning a policy error.
    .eq("user_id", user.id);

  if (error) return { ok: false, errors: { form: error.message } };

  revalidatePath("/profile");
  return { ok: true, message: "Qualification removed." };
}

/** `<select>` posts "" for its placeholder option; the columns want null. */
function emptyToNull(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}
