"use client";

import { useActionState } from "react";

import { requestPasswordResetAction } from "@/lib/auth/actions";
import { EMPTY_FORM_STATE } from "@/lib/auth/form-state";
import { AuthSubmit } from "../auth-submit";
import {
  AuthBody,
  AuthField,
  AuthFormError,
  AuthFormNotice,
  AuthInput,
  MailIcon,
} from "../auth-ui";

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordResetAction, EMPTY_FORM_STATE);

  // The same notice appears whether or not the address is registered — see the
  // action for why. Replacing the form also stops a user resubmitting in the
  // belief that nothing happened.
  if (state.ok && state.message) {
    return <AuthFormNotice>{state.message}</AuthFormNotice>;
  }

  return (
    <form action={formAction}>
      <AuthBody>
        <AuthFormError>{state.errors?.form}</AuthFormError>

        <AuthField id="email" label="Email address" error={state.errors?.email}>
          <AuthInput
            id="email"
            type="email"
            icon={<MailIcon />}
            placeholder="name@example.com"
            autoComplete="email"
            required
            error={state.errors?.email}
          />
        </AuthField>

        <AuthSubmit pendingLabel="Sending…">Send reset link</AuthSubmit>
      </AuthBody>
    </form>
  );
}
