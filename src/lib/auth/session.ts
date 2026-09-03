import "server-only";

import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";

import { sessionDb } from "@/lib/db/clients";
import { PROFILE_COLUMNS, type ProfileRow } from "@/lib/profile/columns";
import { initialsFrom } from "@/lib/profile/initials";

export type Profile = ProfileRow;

/**
 * Reading the current user is dynamic by definition — it depends on this
 * request's cookies. Every function here therefore opts the caller out of
 * static rendering, which is correct but worth knowing: calling `getUser()`
 * from a page that could have been static makes it render per request.
 *
 * `cache()` dedupes within a single request, so a layout and three components
 * asking "who is this?" cost one round trip, not four.
 */

/**
 * The signed-in user, or null.
 *
 * `getUser()` rather than `getSession()`: the session is read straight from a
 * cookie the browser controls, while this is verified against the auth server.
 * For anything that gates access, only the verified answer is worth having.
 */
export const getUser = cache(async (): Promise<User | null> => {
  const db = await sessionDb();
  const { data, error } = await db.auth.getUser();
  // An expired or absent session is an ordinary state, not an exception.
  if (error) return null;
  return data.user;
});

/**
 * The signed-in user, or a redirect to sign-in.
 *
 * Middleware already guards these routes, so reaching the redirect here means
 * something slipped past it — a route added to the page tree but not to the
 * matcher, or a direct call from an unguarded path. Defence in depth: the cost
 * is one comparison, and the failure it prevents is serving someone else's data.
 */
export async function requireUser(nextPath?: string): Promise<User> {
  const user = await getUser();
  if (user) return user;

  const target = nextPath ? `/sign-in?next=${encodeURIComponent(nextPath)}` : "/sign-in";
  redirect(target);
}

/**
 * The current user's profile row.
 *
 * Guaranteed to exist for any authenticated user by the `on_auth_user_created`
 * trigger, so a null here means the row was deleted out of band rather than
 * "not created yet" — the caller does not need a "profile might be missing"
 * branch for the normal path.
 */
export const getProfile = cache(async (): Promise<Profile | null> => {
  const user = await getUser();
  if (!user) return null;

  const db = await sessionDb();
  const { data, error } = await db
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("id", user.id)
    .maybeSingle();

  if (error) return null;
  return data;
});

/**
 * Whether this account already has a password.
 *
 * There is no direct answer to this question on the client. `encrypted_password`
 * lives in `auth.users`, which is not an exposed schema, and — the part that
 * makes this awkward — setting a password on an account that signed up with
 * Google changes *nothing* observable in the session. The identity row stays
 * `google`, `app_metadata.providers` stays `["google"]`, and the JWT is
 * byte-for-byte the shape it was before. Verified against the local stack
 * rather than assumed.
 *
 * So the answer is assembled from the two things that *are* visible:
 *
 *   - `providers` contains `email` — signed up with an address and a password,
 *     so there has always been one.
 *   - `user_metadata.has_password` — written by `updatePasswordAction` at the
 *     moment a password is set, precisely because nothing else records it.
 *
 * `user_metadata` is user-writable, so a determined person can make this return
 * true when it is false. That is worth being explicit about and is fine here:
 * the only thing downstream of this is which of two words a button uses. It
 * gates no access and reveals nothing — the reset flow behaves identically
 * either way. Never widen it into something that does.
 *
 * The remaining wrong answer is honest rather than forged: a password set
 * outside this app — the Supabase dashboard, a direct admin call — leaves no
 * metadata behind, so the button keeps offering to set one. It still works.
 */
export function userHasPassword(user: User): boolean {
  const providers = user.app_metadata.providers;
  if (Array.isArray(providers) && providers.includes("email")) return true;
  return user.user_metadata.has_password === true;
}

/**
 * Who the top bar is drawing, and nothing else.
 *
 * Deliberately not `getProfile()`. That selects thirteen columns to render the
 * profile form; this needs one, and it runs on every page load of every
 * session. Selecting the other twelve to draw two letters in a circle is the
 * whole-row habit this codebase is a reaction to.
 *
 * `profiles.full_name`, not `user_metadata.full_name`, and the distinction is
 * load-bearing: the signup trigger seeds the profile *from* the metadata, but
 * `updateProfileAction` writes only the profile afterwards. Reading metadata
 * would show the name someone signed up with forever, ignoring the one they
 * corrected.
 *
 * The two reads run in parallel. They are independent questions about the same
 * user, and asking them in sequence would make every session wait for both
 * round trips rather than the slower one.
 */
export interface Identity {
  name: string | null;
  email: string | null;
  /** Null when there is no name and no address to derive one from. */
  initials: string | null;
  isAdmin: boolean;
  /** Whether this account can be signed into with a password. See `userHasPassword`. */
  hasPassword: boolean;
}

export async function getIdentity(): Promise<Identity | null> {
  const user = await getUser();
  if (!user) return null;

  const db = await sessionDb();

  const [nameResult, admin] = await Promise.all([
    db.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
    hasRole("admin"),
  ]);

  // A missing profile row is not an error worth failing the top bar over — the
  // address is enough to draw an avatar, and the trigger guarantees the row
  // exists for anyone who signed up normally.
  const name = nameResult.data?.full_name ?? null;
  const email = user.email ?? null;

  return {
    name,
    email,
    initials: initialsFrom(name, email),
    isAdmin: admin,
    hasPassword: userHasPassword(user),
  };
}

/**
 * Whether the current user holds a role.
 *
 * Delegates to the `has_role` SQL function rather than reading `user_roles`
 * directly, so the definition of "is an admin" lives in exactly one place — the
 * same place the RLS policies consult.
 */
export async function hasRole(role: "admin" | "editor"): Promise<boolean> {
  const db = await sessionDb();
  const { data, error } = await db.rpc("has_role", { check_role: role });
  if (error) return false;
  return data;
}
