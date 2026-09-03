"use client";

import { useActionState } from "react";

import { signUpAction } from "@/lib/auth/actions";
import { EMPTY_FORM_STATE } from "@/lib/auth/form-state";
import { AuthSubmit } from "../auth-submit";
import {
  AuthBody,
  AuthField,
  AuthFormError,
  AuthFormNotice,
  AuthInput,
  MailIcon,
  PersonIcon,
} from "../auth-ui";
import { PasswordInput } from "../password-input";

export function SignUpForm({ next }: { next?: string | undefined }) {
  const [state, formAction] = useActionState(signUpAction, EMPTY_FORM_STATE);

  // Success here is "we sent you an email", not a session — so the form is
  // replaced by the notice rather than sitting under it inviting a resubmit.
  if (state.ok && state.message) {
    return <AuthFormNotice>{state.message}</AuthFormNotice>;
  }

  return (
    <form action={formAction}>
      <AuthBody>
        <input type="hidden" name="next" value={next ?? ""} />

        <AuthFormError>{state.errors?.form}</AuthFormError>

        <AuthField id="fullName" label="Full name" error={state.errors?.fullName}>
          <AuthInput
            id="fullName"
            icon={<PersonIcon />}
            placeholder="Your name"
            autoComplete="name"
            required
            error={state.errors?.fullName}
          />
        </AuthField>

        <AuthField id="email" label="Email" error={state.errors?.email}>
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

        <AuthField
          id="password"
          label="Password"
          error={state.errors?.password}
          hint="At least 8 characters."
        >
          <PasswordInput
            id="password"
            autoComplete="new-password"
            placeholder="Create a password"
            error={state.errors?.password}
            hint="At least 8 characters."
          />
        </AuthField>

        <AuthSubmit pendingLabel="Creating account…">Create account</AuthSubmit>
      </AuthBody>
    </form>
  );
}
