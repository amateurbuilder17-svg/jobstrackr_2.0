"use client";

import { useActionState } from "react";

import { updatePasswordAction } from "@/lib/auth/actions";
import { EMPTY_FORM_STATE } from "@/lib/auth/form-state";
import { AuthSubmit } from "../auth-submit";
import { AuthBody, AuthField, AuthFormError } from "../auth-ui";
import { PasswordInput } from "../password-input";

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(updatePasswordAction, EMPTY_FORM_STATE);

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
