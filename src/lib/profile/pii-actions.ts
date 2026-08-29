"use server";

import { getUser } from "@/lib/auth/session";
import { sessionDb } from "@/lib/db/clients";
import { consume, LIMITS } from "@/lib/rate-limit";
import { SECRET_FIELDS, type SecretField } from "./pii";

/**
 * Reveal one identity number, to the person it belongs to.
 *
 * This is the only route in the entire application back to a real Aadhaar, PAN
 * or passport number, and every decision here is about keeping it that way.
 *
 * **One field per call.** The page renders masks; pressing copy on a single row
 * fetches that one value. There is no "give me everything" call, because the
 * page that received one would then be holding all three in browser memory for
 * as long as the tab is open, for the sake of a button nobody pressed.
 *
 * **No user id parameter, here or in the SQL.** `decrypt_own_id` reads
 * `auth.uid()` itself and takes only a field name. An action that accepted an
 * id would be exactly one missing check away from being a way to read anyone's
 * Aadhaar number, and no amount of care in this file would fix that — so the
 * capability does not exist to get wrong.
 *
 * **Rate limited.** Not because a legitimate user copies quickly, but because
 * this is the one endpoint whose output is worth harvesting, and an unbounded
 * one turns a stolen session cookie into a bulk export.
 *
 * **Never logged.** The failure branches deliberately say nothing about the
 * value — an error message carrying a partial number would put it in whatever
 * aggregates the logs.
 */

export type RevealResult =
  | { ok: true; value: string }
  | { ok: false; reason: "unauthenticated" | "rate_limited" | "unavailable" | "empty" };

export async function revealIdAction(field: string): Promise<RevealResult> {
  // Validated against the closed set before it reaches SQL. The function
  // raises on an unknown name, and a raise here would be a 500 on a page
  // somebody is using rather than a clean refusal.
  if (!(SECRET_FIELDS as readonly string[]).includes(field)) {
    return { ok: false, reason: "unavailable" };
  }

  const user = await getUser();
  if (!user) return { ok: false, reason: "unauthenticated" };

  // Tighter than a form post and deliberately so: `LIMITS.ai` is six a minute,
  // which is far more than someone filling one application needs and far less
  // than a script wants.
  if (!consume(`reveal:${user.id}`, LIMITS.ai)) {
    return { ok: false, reason: "rate_limited" };
  }

  const db = await sessionDb();
  const { data, error } = await db.rpc("decrypt_own_id", {
    p_field: field as SecretField,
  });

  if (error) {
    // The message is not forwarded. It can contain the SQL, and the SQL names
    // the columns; there is nothing in it a user can act on.
    console.error(`[pii] reveal failed for ${field}`);
    return { ok: false, reason: "unavailable" };
  }

  if (!data) return { ok: false, reason: "empty" };

  return { ok: true, value: data };
}
