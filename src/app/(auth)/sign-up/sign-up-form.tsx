"use client";

import { useActionState } from "react";

import { signInWithGoogleAction, signUpAction } from "@/lib/auth/actions";
import { EMPTY_FORM_STATE } from "@/lib/auth/form-state";
import { Field, FormError, FormNotice, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";

export function SignUpForm({ next }: { next?: string | undefined }) {
  const [state, formAction] = useActionState(signUpAction, EMPTY_FORM_STATE);

  // Success here is "we sent you an email", not a session — so the form is
  // replaced by the notice rather than sitting under it inviting a resubmit.
  if (state.ok && state.message) {
    return <FormNotice>{state.message}</FormNotice>;
  }

  return (
    <div className="flex flex-col gap-5">
      <form action={signInWithGoogleAction}>
        <input type="hidden" name="next" value={next ?? ""} />
        <Button type="submit" variant="secondary" size="lg" className="w-full">
          Continue with Google
        </Button>
      </form>

      <div className="flex items-center gap-3 text-xs text-ink-3">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

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
