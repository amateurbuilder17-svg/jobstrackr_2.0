"use client";

import { useActionState } from "react";

import { updatePasswordAction } from "@/lib/auth/actions";
import { EMPTY_FORM_STATE } from "@/lib/auth/form-state";
import { Field, FormError, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export function ResetPasswordForm() {
  const [state, formAction] = useActionState(updatePasswordAction, EMPTY_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <FormError>{state.errors?.form}</FormError>

      <Field
        id="password"
        label="New password"
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

      <Field
        id="confirmPassword"
        label="Confirm new password"
        error={state.errors?.confirmPassword}
      >
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          error={state.errors?.confirmPassword}
        />
      </Field>

      <SubmitButton variant="primary" size="lg" className="w-full" pendingLabel="Saving…">
        Save new password
      </SubmitButton>
    </form>
  );
}
