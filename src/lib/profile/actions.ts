"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { type FormState } from "@/lib/auth/form-state";
import {
  educationSchema,
  fieldErrors,
  matchPreferencesSchema,
  matchProfileSchema,
  profileSchema,
} from "@/lib/auth/schemas";
import { parseSalaryBand } from "@/lib/match/vocab";
import { getUser } from "@/lib/auth/session";
import { consume, LIMITS } from "@/lib/rate-limit";
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

  if (!consume(`form:${user.id}`, LIMITS.form)) {
    return { ok: false, errors: { form: "Too many changes at once. Try again shortly." } };
  }

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

  // Read before the write, because the write itself sets `onboarding_completed`
  // — afterwards there is no way to tell a first save from an edit, and only
  // the first one should carry the user off this page.
  const { data: before } = await db
    .from("profiles")
    .select("onboarding_completed")
    .eq("id", user.id)
    .maybeSingle();

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
  revalidatePath("/my-details");

  // Finishing onboarding is the one save that has somewhere to go: the feed the
  // form exists to fill. Leaving someone on the form they just completed, with
  // a "Profile saved." line and no next step, is the missing redirect. Later
  // edits are edits — they stay put and get the message.
  if (!before?.onboarding_completed) {
    revalidatePath("/for-you");
    redirect("/for-you");
  }

  return { ok: true, message: "Profile saved." };
}

export async function upsertEducationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getUser();
  if (!user) return { ok: false, errors: { form: "Your session has expired." } };

  if (!consume(`form:${user.id}`, LIMITS.form)) {
    return { ok: false, errors: { form: "Too many changes at once. Try again shortly." } };
  }

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
  revalidatePath("/my-details");
  return { ok: true, message: "Qualification saved." };
}

export async function deleteEducationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getUser();
  if (!user) return { ok: false, errors: { form: "Your session has expired." } };

  if (!consume(`form:${user.id}`, LIMITS.form)) {
    return { ok: false, errors: { form: "Too many changes at once. Try again shortly." } };
  }

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
  revalidatePath("/my-details");
  return { ok: true, message: "Qualification removed." };
}

/** `<select>` posts "" for its placeholder option; the columns want null. */
function emptyToNull(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * The three fields the For You matcher cannot work without.
 *
 * `match_jobs` hard-filters on age, on qualification level and on discipline,
 * and treats an unknown value as a non-match — so a profile missing any of them
 * produces an empty feed no matter how many jobs are open. The old app asked
 * for these through a six-step wizard on its own route; the current page links
 * to /profile and hopes.
 *
 * This is the third option: the three fields, inline, on the page whose
 * emptiness they explain. One round trip, and the feed below the form fills in.
 *
 * It writes to both tables because the answer lives in both: age and level on
 * `profiles`, discipline on `education_qualifications` — which is where
 * `stream_of` reads from, and why a level with no discipline still matches
 * nothing but "any discipline" postings.
 */
export async function completeMatchProfileAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getUser();
  if (!user) return { ok: false, errors: { form: "Your session has expired." } };

  if (!consume(`form:${user.id}`, LIMITS.form)) {
    return { ok: false, errors: { form: "Too many changes at once. Try again shortly." } };
  }

  const parsed = matchProfileSchema.safeParse({
    dateOfBirth: formData.get("dateOfBirth"),
    highestQualification: emptyToNull(formData.get("highestQualification")),
    discipline: formData.get("discipline"),
  });

  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const p = parsed.data;

  const db = await sessionDb();

  const { error } = await db
    .from("profiles")
    .update({
      date_of_birth: p.dateOfBirth,
      highest_qualification: p.highestQualification,
    })
    .eq("id", user.id);

  if (error) return { ok: false, errors: { form: error.message } };

  if (p.discipline) {
    // Upserted against the level rather than blindly inserted: someone
    // correcting "Histry" to "History" should end with one row, not two, and
    // the matcher reads every row this user has.
    const { data: existing } = await db
      .from("education_qualifications")
      .select("id")
      .eq("user_id", user.id)
      .eq("level", p.highestQualification)
      .maybeSingle();

    const { error: educationError } = existing
      ? await db
          .from("education_qualifications")
          .update({ discipline: p.discipline })
          .eq("id", existing.id)
          .eq("user_id", user.id)
      : await db.from("education_qualifications").insert({
          user_id: user.id,
          level: p.highestQualification,
          discipline: p.discipline,
        });

    if (educationError) return { ok: false, errors: { form: educationError.message } };
  }

  revalidatePath("/for-you");
  revalidatePath("/profile");
  return { ok: true, message: "Saved. Your matches are below." };
}

/**
 * The rest of the old wizard's answers, as one save.
 *
 * The old app spread these across six screens and stored them in the browser.
 * They are five multi-selects and a radio group, all optional, all changing the
 * same feed — so they are one form and one round trip, on the page whose
 * results they change.
 *
 * ── Why this one is not a `useActionState` action ──────────────────────────
 * Every other form here returns a `FormState` and is driven by a Client
 * Component, which is right when a field can be rejected and the message has to
 * land next to it. Nothing here can be: `matchPreferencesSchema` filters
 * unrecognised values rather than refusing them, because a save that quietly
 * drops one stale checkbox is better than one that rejects five good answers to
 * punish a sixth.
 *
 * So there is no state to hold, and holding none means the form can be a Server
 * Component — sixty checkboxes, thirty-six states and twelve sectors of markup
 * that ship as HTML rather than as JavaScript. /for-you has about a kilobyte of
 * headroom against `defaultRouteKb`; this is how it keeps it. Feedback comes
 * back as a query parameter, which needs no bundle at all.
 */
export async function updateMatchPreferencesAction(formData: FormData): Promise<void> {
  const user = await getUser();
  if (!user) redirect("/sign-in?next=/for-you");

  if (!consume(`form:${user.id}`, LIMITS.form)) {
    redirect("/for-you?prefs=slow");
  }

  const input = {
    // `getAll` gives an array even for one value, and `[]` for an absent field
    // — which is the column default, so an unchecked group clears cleanly.
    skills: formData.getAll("skills"),
    preferredGrades: formData.getAll("preferredGrades"),
    preferredSectors: formData.getAll("preferredSectors"),
    preferredStates: formData.getAll("preferredStates"),
    salaryBand: formData.get("salaryBand") ?? "",
  };

  // Cannot fail — see the schema. `parse` rather than `safeParse` so that a
  // future edit which makes it failable is a loud crash here rather than a
  // silent no-op the user reads as "the save button does nothing".
  const p = matchPreferencesSchema.parse(input);

  const [salaryMin, salaryMax] = parseSalaryBand(p.salaryBand || null);

  const db = await sessionDb();

  const { error } = await db
    .from("profiles")
    .update({
      skills: p.skills,
      preferred_grades: p.preferredGrades,
      preferred_sectors: p.preferredSectors,
      preferred_states: p.preferredStates,
      preferred_salary_min: salaryMin,
      preferred_salary_max: salaryMax,
    })
    .eq("id", user.id);

  // Genuinely exceptional: RLS scopes the write to the owner and every value
  // has already been filtered to the vocabulary. There is no user-correctable
  // form of this, so it belongs on the error boundary rather than in a chip.
  if (error) throw new Error(`Could not save your preferences: ${error.message}`);

  revalidatePath("/for-you");
  revalidatePath("/profile");
  redirect("/for-you?prefs=saved");
}
