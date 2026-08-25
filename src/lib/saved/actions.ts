"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getUser } from "@/lib/auth/session";
import { consume, LIMITS } from "@/lib/rate-limit";
import { sessionDb } from "@/lib/db/clients";
import { PAGE_SIZE } from "@/lib/db/cursor";

/**
 * Saved-job mutations.
 *
 * These are called from a client component with typed arguments rather than a
 * FormData, because the caller is an optimistic toggle rather than a form
 * submission. That makes the argument attacker-controlled in exactly the same
 * way a form field is, so it is validated here with the same suspicion.
 */

const jobId = z.uuid("Not a job id.");

/** What the optimistic UI needs back: the truth, so it can reconcile. */
export interface SaveResult {
  ok: boolean;
  /** The server's view of the state after this call. */
  saved: boolean;
  /** Present only on failure, for the retry queue to reason about. */
  reason?: "unauthenticated" | "invalid" | "error";
}

export async function setJobSavedAction(rawJobId: string, saved: boolean): Promise<SaveResult> {
  const parsed = jobId.safeParse(rawJobId);
  if (!parsed.success) return { ok: false, saved: !saved, reason: "invalid" };

  const user = await getUser();
  // Not an error worth shouting about: a guest saving a job is a supported
  // flow. The client keeps it locally and merges it on first sign-in.
  if (!user) return { ok: false, saved: !saved, reason: "unauthenticated" };

  // Keyed by user, not IP: the offline queue replays on reconnect and a stuck
  // retry loop is the realistic way this gets hammered, not an attacker.
  // Refused calls stay queued client-side and are retried, so the user loses
  // nothing.
  if (!consume(`save:${user.id}`, LIMITS.save)) {
    return { ok: false, saved: !saved, reason: "error" };
  }

  const db = await sessionDb();

  const { error } = saved
    ? await db
        .from("saved_jobs")
        // Re-saving something already saved is a no-op rather than a duplicate
        // key error — the button can be pressed twice, and offline replay can
        // deliver the same intent more than once.
        .upsert({ user_id: user.id, job_id: parsed.data }, { onConflict: "user_id,job_id" })
    : await db.from("saved_jobs").delete().eq("user_id", user.id).eq("job_id", parsed.data);

  if (error) return { ok: false, saved: !saved, reason: "error" };

  revalidatePath("/saved");
  return { ok: true, saved };
}

/**
 * Folds a guest's locally-saved jobs into their account on first sign-in.
 *
 * Insert-only and idempotent. A guest's local list is additive by nature — they
 * had no account to delete from — so the merge must never remove a row that is
 * already on the account. Someone who saved a job on their phone, signed in on
 * a laptop, and unsaved it there should not have it resurrected by the phone's
 * stale local copy.
 */
export async function mergeGuestSavesAction(rawIds: string[]): Promise<SaveResult> {
  const user = await getUser();
  if (!user) return { ok: false, saved: false, reason: "unauthenticated" };

  const ids = [...new Set(rawIds)]
    .filter((id) => jobId.safeParse(id).success)
    // Bounded: this array arrives from localStorage, which anyone can edit.
    .slice(0, PAGE_SIZE.savedIds);

  if (ids.length === 0) return { ok: true, saved: false };

  const db = await sessionDb();
  const { error } = await db.from("saved_jobs").upsert(
    ids.map((id) => ({ user_id: user.id, job_id: id })),
    { onConflict: "user_id,job_id", ignoreDuplicates: true },
  );

  if (error) return { ok: false, saved: false, reason: "error" };

  revalidatePath("/saved");
  return { ok: true, saved: true };
}
