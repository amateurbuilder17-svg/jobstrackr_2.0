"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { sessionDb } from "@/lib/db/clients";
import { consume, LIMITS } from "@/lib/rate-limit";
import { env } from "@/lib/env";
import { safeNext, type FormState } from "./form-state";
import {
  fieldErrors,
  requestPasswordResetSchema,
  signInSchema,
  signUpSchema,
  updatePasswordSchema,
} from "./schemas";

/* ── Sign in ───────────────────────────────────────────────────────────── */

export async function signInAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };

  const db = await sessionDb();
  const { error } = await db.auth.signInWithPassword(parsed.data);

  if (error) {
    // Deliberately does not distinguish "no such account" from "wrong
    // password". The precise answer is a user-enumeration oracle: it tells an
    // attacker which addresses are registered here, for free.
    return {
      ok: false,
      errors: { form: "That email and password combination is not correct." },
    };
  }

  // Outside the error branch on purpose: `redirect` works by throwing, so
  // calling it inside a try/catch would be caught as a failure.
  redirect(safeNext(formData.get("next")));
}

/* ── Sign up ───────────────────────────────────────────────────────────── */

export async function signUpAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    fullName: formData.get("fullName"),
  });

  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };

  const db = await sessionDb();
  const { data, error } = await db.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Read by the `handle_new_user` trigger to seed profiles.full_name, so a
      // new account arrives with a name already on it.
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
    },
  });

  if (error) {
    return { ok: false, errors: { form: error.message } };
  }

  // With email confirmation on, Supabase returns a user and no session. It also
  // returns that same shape for an address that already exists, which is
  // intentional on their side and useful on ours: the response is identical
  // whether or not the account is new, so this page cannot be used to test
  // which emails are registered.
  if (!data.session) {
    return {
      ok: true,
      message: "Check your email for a link to confirm your account.",
    };
  }

  redirect("/profile");
}

/* ── Google ────────────────────────────────────────────────────────────── */

export async function signInWithGoogleAction(formData: FormData): Promise<void> {
  const db = await sessionDb();
  const next = safeNext(formData.get("next"));

  const { data, error } = await db.auth.signInWithOAuth({
    provider: "google",
    options: {
      // Supabase sends the browser back here with a code; the callback route
      // trades it for a session. `next` rides along so the round trip still
      // ends where the user was going.
      redirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  });

  if (error || !data.url) {
    redirect(`/sign-in?error=${encodeURIComponent("Google sign-in is unavailable.")}`);
  }

  redirect(data.url);
}

/* ── Sign out ──────────────────────────────────────────────────────────── */

export async function signOutAction(): Promise<void> {
  const db = await sessionDb();
  await db.auth.signOut();

  // The shell is shared by every route, so anything rendered from the session
  // has to be dropped rather than left in the router cache.
  revalidatePath("/", "layout");
  redirect("/");
}

/* ── Password reset ────────────────────────────────────────────────────── */

export async function requestPasswordResetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = requestPasswordResetSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };

  // Keyed by address rather than user: there is no session here, and the cost
  // of abuse falls on whoever owns that inbox. Refusal returns the same message
  // as success, for the same enumeration reason as everything else on this form.
  if (!consume(`reset:${parsed.data.email}`, LIMITS.email)) {
    return {
      ok: true,
      message: "If that address has an account, a reset link is on its way.",
    };
  }

  const db = await sessionDb();
  await db.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/reset-password`,
  });

  // The result is ignored on purpose, and the message is the same either way.
  // Reporting "no account with that email" would turn this form into the
  // enumeration oracle the sign-in form is careful not to be.
  return {
    ok: true,
    message: "If that address has an account, a reset link is on its way.",
  };
}

export async function updatePasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = updatePasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) return { ok: false, errors: fieldErrors(parsed.error) };

  const db = await sessionDb();

  // Reaching this page means the recovery link was already exchanged for a
  // session by the callback route. Without one, `updateUser` would happily
  // report success against nobody, so the check is explicit.
  const { data: userData } = await db.auth.getUser();
  if (!userData.user) {
    return {
      ok: false,
      errors: { form: "This reset link has expired. Request a new one." },
    };
  }

  const { error } = await db.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, errors: { form: error.message } };

  redirect("/profile");
}
