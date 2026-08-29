"use client";

import { useActionState } from "react";

import { signUpAction } from "@/lib/auth/actions";
import { EMPTY_FORM_STATE } from "@/lib/auth/form-state";
import { GoogleAuth } from "@/components/auth/google-auth";
import { Field, FormError, FormNotice, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export function SignUpForm({
  next,
  google,
}: {
  next?: string | undefined;
  /** False when the project has no Google provider configured — see providers.ts. */
  google: boolean;
}) {
  const [state, formAction] = useActionState(signUpAction, EMPTY_FORM_STATE);

  // Success here is "we sent you an email", not a session — so the form is
  // replaced by the notice rather than sitting under it inviting a resubmit.
  if (state.ok && state.message) {
    return <FormNotice>{state.message}</FormNotice>;
  }

  return (
    <div className="flex flex-col gap-5">
      {google ? <GoogleAuth next={next} label="Sign up with Google" /> : null}

      <form action={formAction} className="flex flex-col gap-4">
        <FormError>{state.errors?.form}</FormError>

        <Field id="fullName" label="Full name" error={state.errors?.fullName}>
          <Input id="fullName" autoComplete="name" required error={state.errors?.fullName} />
        </Field>

        <Field id="email" label="Email" error={state.errors?.email}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            error={state.errors?.email}
          />
        </Field>

        <Field
          id="password"
          label="Password"
          error={state.errors?.password}
          hint="At least 8 characters."
        >
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            error={state.errors?.password}
          />
        </Field>

        <SubmitButton
          variant="primary"
          size="lg"
          className="w-full"
          pendingLabel="Creating account…"
        >
          Create account
        </SubmitButton>
      </form>
    </div>
  );
}
