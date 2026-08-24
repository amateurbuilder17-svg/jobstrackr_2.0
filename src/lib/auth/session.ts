import "server-only";

import type { User } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { cache } from "react";

import { sessionDb } from "@/lib/db/clients";
import { PROFILE_COLUMNS, type ProfileRow } from "@/lib/profile/columns";

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
