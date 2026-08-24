"use client";

import { useActionState } from "react";

import { requestPasswordResetAction } from "@/lib/auth/actions";
import { EMPTY_FORM_STATE } from "@/lib/auth/form-state";
import { Field, FormError, FormNotice, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordResetAction, EMPTY_FORM_STATE);

  // The same notice appears whether or not the address is registered — see the
  // action for why. Replacing the form also stops a user resubmitting in the
  // belief that nothing happened.
  if (state.ok && state.message) {
    return <FormNotice>{state.message}</FormNotice>;
  }

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError>{state.errors?.form}</FormError>

      <Field id="email" label="Email" error={state.errors?.email}>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          error={state.errors?.email}
        />
      </Field>

      <SubmitButton variant="primary" size="lg" className="w-full" pendingLabel="Sending…">
        Send reset link
      </SubmitButton>
    </form>
  );
}
