"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { userHasPassword } from "@/lib/auth/session";
import { sessionDb } from "@/lib/db/clients";
import { env } from "@/lib/env";
import { consume, LIMITS } from "@/lib/rate-limit";
import { callbackOrigin } from "./callback-origin";
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

  // Keyed by the submitted address, so guesses spread across hosts still
  // converge on one bucket. This leaks nothing about whether the account
  // exists — an unregistered address is limited exactly the same way.
  if (!consume(`signin:${parsed.data.email}`, LIMITS.signIn)) {
    return {
      ok: false,
      errors: { form: "Too many sign-in attempts. Wait a minute and try again." },
    };
  }

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

  // Signup sends a confirmation mail, so an unthrottled form is a way to bill
  // someone else's inbox — and, since the switch to Resend, our own quota.
  // Refusal returns the same wording as success for the enumeration reason
  // described below.
  if (!consume(`signup:${parsed.data.email}`, LIMITS.email)) {
    return {
      ok: true,
      message: "Check your email for a link to confirm your account.",
    };
  }

  const db = await sessionDb();
  const { data, error } = await db.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Read by the `handle_new_user` trigger to seed profiles.full_name, so a
      // new account arrives with a name already on it.
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${await callbackOrigin()}/auth/callback`,
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
      redirectTo: `${await callbackOrigin()}/auth/callback?next=${encodeURIComponent(next)}`,
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

/** True when the app is pointed at a `supabase start` stack rather than a real project. */
function isLocalAuthServer(): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(
    env.NEXT_PUBLIC_SUPABASE_URL,
  );
}

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
  const { error } = await db.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await callbackOrigin()}/auth/callback?next=/reset-password`,
  });

  // The *user-facing* result is the same either way, on purpose: reporting "no
  // account with that email" would turn this form into the enumeration oracle
  // the sign-in form is careful not to be.
  //
  // The error still has to go somewhere, though. Discarding it entirely — which
  // is what this did — makes a dead mailer indistinguishable from a working one
  // from every angle at once: the form says the link is on its way, the action
  // returns ok, and nothing is written anywhere. A misconfigured SMTP host, an
  // origin missing from the auth server's redirect allow-list, or the auth
  // server simply being unreachable all present as success. So it is logged
  // server-side, where the address is already known and no one is being told
  // anything they could not find out by trying to sign in.
  if (error) {
    console.error("[auth] password reset email failed", {
      email: parsed.data.email,
      status: error.status,
      code: error.code,
      message: error.message,
    });
  } else if (isLocalAuthServer()) {
    // The local stack sends through the same Resend account production uses —
    // see the `[auth.email.smtp]` block in supabase/config.toml for why, and
    // for what that costs. So this line is not a debugging aid, it is a
    // receipt: a real message just left for a real inbox from a dev machine,
    // spending shared quota. Typing the wrong address into a local form is no
    // longer a private mistake, and the output should say so at the moment it
    // happens rather than in someone else's inbox.
    console.warn(`[auth] real reset email sent from the local stack to ${parsed.data.email}`);
  }

  return {
    ok: true,
    message: "If that address has an account, a reset link is on its way.",
  };
}

/**
 * Send a reset link to the signed-in user's own address.
 *
 * The menu needs this because `/forgot-password` is unreachable for anyone
 * signed in — it is in `AUTH_ONLY`, so middleware bounces them to `/profile`.
 * That rule is right: the page exists to help someone who cannot get in.
 * Someone who *is* in and wants a new password is a different flow, and this is
 * it.
 *
 * The address comes from the session, never from the form. A hidden email field
 * would turn a signed-in control into an unauthenticated mailer — anyone could
 * post any address to it and this site would send the mail.
 *
 * Unlike the signed-out version there is no enumeration concern here, so this
 * can say plainly what happened and to which address.
 */
export async function resetOwnPasswordAction(_prev: FormState): Promise<FormState> {
  const db = await sessionDb();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user?.email) {
    return { ok: false, message: "Sign in first to change your password." };
  }

  if (!consume(`reset:${user.email}`, LIMITS.email)) {
    return { ok: false, message: "A link was just sent. Check your inbox, then try again." };
  }

  const { error } = await db.auth.resetPasswordForEmail(user.email, {
    redirectTo: `${await callbackOrigin()}/auth/callback?next=/reset-password`,
  });

  if (error) {
    // Same reason as the signed-out version: the wording the user sees is
    // deliberately vague, so the reason has to be recoverable from the logs.
    console.error("[auth] password reset email failed", {
      email: user.email,
      status: error.status,
      code: error.code,
      message: error.message,
    });
    return { ok: false, message: "Could not send the link. Try again in a moment." };
  }

  return {
    ok: true,
    message: userHasPassword(user)
      ? `Reset link sent to ${user.email}.`
      : `Link sent to ${user.email}. Follow it to choose a password.`,
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

  // The flag rides along with the password rather than in a second call, so
  // there is no window where the password is set and the record of it is not.
  //
  // It exists because nothing else survives this write: setting a password on a
  // Google account leaves the identity, the providers list and the JWT exactly
  // as they were, so without this the app can never tell afterwards that the
  // account has one. `userHasPassword` is the reader; its comment covers why
  // user-writable metadata is an acceptable home for it.
  const { error } = await db.auth.updateUser({
    password: parsed.data.password,
    data: { has_password: true },
  });
  if (error) return { ok: false, errors: { form: error.message } };

  // Deliberately not a redirect, and specifically not one to `/profile`.
  //
  // This flow ends on a full-bleed screen — the `(auth)` layout hides every
  // piece of app chrome — so the only way out of it is one this action puts
  // there. Sending the user to `/profile` instead handed them an onboarding
  // form they never asked for, with no "skip" once `onboarding_completed` is
  // true and no statement that the password had actually changed: a dead end
  // dressed as a next step.
  //
  // Returning success keeps the confirmation on the screen that did the work
  // and lets the form offer the way onward, the same shape `/forgot-password`
  // already uses for a flow whose success is a message rather than a jump.
  return { ok: true, message: "Your password has been updated." };
}
