"use client";

import Link from "next/link";
import { useActionState } from "react";

import { updatePasswordAction } from "@/lib/auth/actions";
import { EMPTY_FORM_STATE } from "@/lib/auth/form-state";
import { AuthSubmit } from "../auth-submit";
import { AuthBody, AuthField, AuthFormError, AuthFormNotice } from "../auth-ui";
import styles from "../auth.module.css";
import { PasswordInput } from "../password-input";

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(updatePasswordAction, EMPTY_FORM_STATE);

  // The success screen has to carry its own exit. This layout is `data-fullbleed`,
  // so the sidebar, top bar and bottom nav are all hidden here — without a link
  // of its own, "password saved" is a screen with nothing on it to press.
  //
  // Home rather than `/profile`: the user came here to change a password, and
  // finishing that should return them to the app, not open an unrelated form.
  // Profile is offered second for anyone who did want it.
  if (state.ok && state.message) {
    return (
      <AuthBody>
        <AuthFormNotice>{state.message}</AuthFormNotice>

        <Link href="/" className={styles.submitLink}>
          Continue to JobsTrackr
        </Link>

        <p className={styles.footer}>
          Want to finish setting up?
          <Link href="/profile" className={styles.link}>
            Go to your profile
          </Link>
        </p>
      </AuthBody>
    );
  }

  return (
    <form action={formAction}>
      <AuthBody>
        <AuthFormError>{state.errors?.form}</AuthFormError>

        <AuthField
          id="password"
          label="New password"
          error={state.errors?.password}
          hint="At least 8 characters."
        >
          <PasswordInput
            id="password"
            autoComplete="new-password"
            error={state.errors?.password}
            hint="At least 8 characters."
          />
        </AuthField>

        <AuthField
          id="confirmPassword"
          label="Confirm password"
          error={state.errors?.confirmPassword}
        >
          <PasswordInput
            id="confirmPassword"
            autoComplete="new-password"
            error={state.errors?.confirmPassword}
          />
        </AuthField>

        <AuthSubmit pendingLabel="Saving…">Save password</AuthSubmit>
      </AuthBody>
    </form>
  );
}
