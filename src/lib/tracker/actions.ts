"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { type FormState } from "@/lib/auth/form-state";
import { fieldErrors } from "@/lib/auth/schemas";
import { getUser } from "@/lib/auth/session";
import { consume, LIMITS } from "@/lib/rate-limit";
import { sessionDb } from "@/lib/db/clients";
import { ATTEMPT_STATUSES } from "./enums";
import { attemptSchema } from "./schema";

/**
 * Tracker mutations.
 *
 * Same shape as the profile actions and for the same reasons: the user comes
 * from the verified session, every write is scoped to their id, and RLS refuses
 * anything that slips past. See `education_owner_all` and its proof in
 * `02_rls_proof.sql`.
 */

export async function saveAttemptAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getUser();
  if (!user) return { ok: false, errors: { form: "Your session has expired." } };

  if (!consume(`form:${user.id}`, LIMITS.form)) {
    return { ok: false, errors: { form: "Too many changes at once. Try again shortly." } };
  }

  const parsed = attemptSchema.safeParse({
    examId: formData.get("examId"),
    customName: formData.get("customName"),
    stage: formData.get("stage"),
    status: formData.get("status"),
    appliedAt: formData.get("appliedAt"),
    examDate: formData.get("examDate"),
    resultDate: formData.get("resultDate"),
    rollNumber: formData.get("rollNumber"),
    score: formData.get("score"),
    notes: formData.get("notes"),
  });

  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };
  const a = parsed.data;

  const row = {
    user_id: user.id,
    exam_id: a.examId,
    custom_name: a.customName,
    stage: a.stage,
    status: a.status,
    applied_at: a.appliedAt,
    exam_date: a.examDate,
    result_date: a.resultDate,
    roll_number: a.rollNumber,
    score: a.score,
    notes: a.notes,
  };

  const db = await sessionDb();

  // An existing id means an edit. It is scoped by owner as well as by id, so a
  // forged id updates nothing rather than returning a policy error.
  const id = formData.get("id");
  const { error } =
    typeof id === "string" && id !== ""
      ? await db.from("exam_attempts").update(row).eq("id", id).eq("user_id", user.id)
      : await db.from("exam_attempts").insert(row);

  if (error) return { ok: false, errors: { form: error.message } };

  revalidatePath("/tracker");
  return { ok: true, message: "Saved." };
}

/**
 * Status-only update, for the inline control on each row.
 *
 * Separate from the full form because changing "Applied" to "Admit card out"
 * should be one tap, not a round trip through a dialog with ten fields — and
 * because a partial update through the full schema would blank every field the
 * inline control does not send.
 */
export async function setAttemptStatusAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await getUser();
  if (!user) return { ok: false, errors: { form: "Your session has expired." } };

  if (!consume(`form:${user.id}`, LIMITS.form)) {
    return { ok: false, errors: { form: "Too many changes at once. Try again shortly." } };
  }

  const parsed = z
    .object({ id: z.uuid(), status: z.enum(ATTEMPT_STATUSES) })
    .safeParse({ id: formData.get("id"), status: formData.get("status") });

  if (!parsed.success) return { ok: false, errors: { form: "That is not a valid status." } };

  const db = await sessionDb();
  const { error } = await db
    .from("exam_attempts")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.id)
    .eq("user_id", user.id);

  if (error) return { ok: false, errors: { form: error.message } };

  revalidatePath("/tracker");
  return { ok: true };
}

export async function deleteAttemptAction(
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
  const { error } = await db.from("exam_attempts").delete().eq("id", id).eq("user_id", user.id);

  if (error) return { ok: false, errors: { form: error.message } };

  revalidatePath("/tracker");
  return { ok: true, message: "Removed." };
}

/**
 * Track a job from its detail page.
 *
 * Called with a typed argument rather than a FormData, because the caller is a
 * button in a sticky action bar rather than a form — see `setJobSavedAction`,
 * which is the same shape for the same reason, and validates its argument with
 * the same suspicion.
 *
 * Idempotent by construction. `exam_attempts_user_job_idx` allows one attempt
 * per person per job, and a violation of it is reported as success: pressing
 * Track twice means what pressing it once meant. The alternative — an upsert —
 * cannot be expressed here, because PostgREST's `onConflict` has no way to name
 * the partial index's `where job_id is not null` predicate.
 */
export interface TrackResult {
  ok: boolean;
  tracking: boolean;
  /** True when the row already existed, so the button can say so. */
  already?: boolean;
  reason?: "unauthenticated" | "invalid" | "error";
}

export async function trackJobAction(rawJobId: string): Promise<TrackResult> {
  const parsed = z.uuid().safeParse(rawJobId);
  if (!parsed.success) return { ok: false, tracking: false, reason: "invalid" };

  const user = await getUser();
  // Not an error worth shouting about — the button offers sign-in instead.
  if (!user) return { ok: false, tracking: false, reason: "unauthenticated" };

  if (!consume(`form:${user.id}`, LIMITS.form)) {
    return { ok: false, tracking: false, reason: "error" };
  }

  const db = await sessionDb();

  const { error } = await db.from("exam_attempts").insert({
    user_id: user.id,
    job_id: parsed.data,
    status: "tracking",
  });

  if (error) {
    // 23505 is the unique index doing its job.
    if (error.code === "23505") return { ok: true, tracking: true, already: true };
    return { ok: false, tracking: false, reason: "error" };
  }

  revalidatePath("/tracker");
  return { ok: true, tracking: true };
}

/** Stop tracking, from the same button. */
export async function untrackJobAction(rawJobId: string): Promise<TrackResult> {
  const parsed = z.uuid().safeParse(rawJobId);
  if (!parsed.success) return { ok: false, tracking: true, reason: "invalid" };

  const user = await getUser();
  if (!user) return { ok: false, tracking: true, reason: "unauthenticated" };

  if (!consume(`form:${user.id}`, LIMITS.form)) {
    return { ok: false, tracking: true, reason: "error" };
  }

  const db = await sessionDb();
  const { error } = await db
    .from("exam_attempts")
    .delete()
    .eq("user_id", user.id)
    .eq("job_id", parsed.data);

  if (error) return { ok: false, tracking: true, reason: "error" };

  revalidatePath("/tracker");
  return { ok: true, tracking: false };
}
