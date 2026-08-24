"use client";

import Link from "next/link";
import { useActionState } from "react";

import { signInAction, signInWithGoogleAction } from "@/lib/auth/actions";
import { EMPTY_FORM_STATE } from "@/lib/auth/form-state";
import { Field, FormError, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";

export function SignInForm({
  next,
  initialError,
}: {
  next?: string | undefined;
  initialError?: string | undefined;
}) {
  const [state, formAction] = useActionState(signInAction, EMPTY_FORM_STATE);

  // `initialError` arrives in the query string from the OAuth callback, which
  // redirects here rather than rendering its own failure page.
  const formError = state.errors?.form ?? initialError;

  return (
    <div className="flex flex-col gap-5">
      {/* Google first: it is one click against seven fields, and most returning
          users took that path originally. */}
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
        <input type="hidden" name="next" value={next ?? ""} />

        <FormError>{formError}</FormError>

        <Field id="email" label="Email" error={state.errors?.email}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            error={state.errors?.email}
          />
        </Field>

        <Field id="password" label="Password" error={state.errors?.password}>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            error={state.errors?.password}
          />
        </Field>

        <SubmitButton variant="primary" size="lg" className="w-full" pendingLabel="Signing in…">
          Sign in
        </SubmitButton>
      </form>

      <Link
        href="/forgot-password"
        className="text-center text-sm text-ink-2 hover:text-ink hover:underline"
      >
        Forgot your password?
      </Link>
    </div>
  );
}
