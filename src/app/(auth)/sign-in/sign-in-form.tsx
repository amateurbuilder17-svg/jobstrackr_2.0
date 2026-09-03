"use client";

import { useActionState } from "react";

import { signInAction } from "@/lib/auth/actions";
import { EMPTY_FORM_STATE } from "@/lib/auth/form-state";
import { AuthSubmit } from "../auth-submit";
import { AuthBody, AuthField, AuthFormError, AuthInput, AuthLink, MailIcon } from "../auth-ui";
import { PasswordInput } from "../password-input";

/**
 * Only the form is a Client Component.
 *
 * The tabs, the heading, the Google block and the footer around it are
 * server-rendered by the page — they have no state, and pulling them in here
 * would put four components and their markup into this route's client bundle
 * to no purpose. What genuinely needs the boundary is `useActionState`: the
 * per-field errors the action returns have to re-render the fields that
 * produced them.
 */
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
    <form action={formAction}>
      <AuthBody>
        <input type="hidden" name="next" value={next ?? ""} />

        <AuthFormError>{formError}</AuthFormError>

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
          action={<AuthLink href="/forgot-password">Forgot password?</AuthLink>}
        >
          <PasswordInput
            id="password"
            autoComplete="current-password"
            error={state.errors?.password}
          />
        </AuthField>

        <AuthSubmit pendingLabel="Signing in…">Sign in</AuthSubmit>
      </AuthBody>
    </form>
  );
}
