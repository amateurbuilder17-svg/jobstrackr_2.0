"use server";

import { getUser } from "@/lib/auth/session";
import { fieldErrors } from "@/lib/auth/schemas";
import type { FormState } from "@/lib/auth/form-state";
import { sessionDb } from "@/lib/db/clients";
import { consume, LIMITS } from "@/lib/rate-limit";
import { feedbackSchema } from "./schema";

/**
 * File a suggestion or a grievance.
 *
 * ## Why this is a Server Action and not a client insert
 *
 * The old app called `supabase.from("suggestions_grievances").insert()` straight
 * from the browser and rate-limited by counting timestamps in `localStorage`.
 * That is not a rate limit — it is a request that the sender please not send too
 * many, honoured by everyone except the only person it was meant to stop. The
 * limit now lives on the server, where refusing actually refuses.
 *
 * ## Anonymity means anonymous
 *
 * When the box is ticked, neither `user_id` nor `email` is written — not a
 * hashed id, not the address "just in case we need to reply". A row that
 * records who sent it is not anonymous no matter what the form promised, and
 * the promise is the whole reason somebody ticks the box: they are about to say
 * something they would not say with their name on it.
 *
 * The address is taken from the session when there is one, not from the form
 * field. The field is filled in and disabled for signed-in users, and a
 * disabled input is a display, not a guarantee — its value can be edited or the
 * request replayed. Reading the session instead means a signed-in report always
 * carries the address that account can actually be reached at.
 */
export async function submitFeedbackAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = feedbackSchema.safeParse({
    kind: formData.get("kind"),
    anonymous: formData.get("anonymous") !== null,
    email: formData.get("email") ?? "",
    message: formData.get("message"),
  });

  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };

  const { kind, anonymous, message } = parsed.data;
  const user = await getUser();

  // Keyed by user where there is one and by kind otherwise. A guest bucket
  // shared across an instance is coarse, and deliberately so: this endpoint
  // writes a row for anyone at all, and the alternative — keying on an
  // unverified email from the form — is a limit anyone can reset by typing a
  // different address.
  const bucket = user ? `feedback:${user.id}` : "feedback:anon";
  if (!consume(bucket, LIMITS.email)) {
    return {
      ok: false,
      errors: { form: "You have sent several messages just now. Try again in a minute." },
    };
  }

  const db = await sessionDb();

  const { error } = await db.from("suggestions_grievances").insert({
    kind,
    message,
    // Both null under anonymity. See the note above — this is the whole
    // promise, and it is kept here or not at all.
    user_id: anonymous ? null : (user?.id ?? null),
    // The session's address wins; the form's is the guest path. `|| null`
    // rather than `?? null` on the second, because the schema lets it through
    // as "" when the box was ticked and an empty string is not an address.
    email: anonymous ? null : (user?.email ?? (parsed.data.email || null)),
  });

  if (error) {
    return {
      ok: false,
      errors: { form: "Could not send that. Try again in a moment." },
    };
  }

  return {
    ok: true,
    message:
      kind === "grievance"
        ? "Thank you — your grievance is logged and we read every one."
        : "Thank you — your suggestion is logged.",
  };
}
