"use client";

import { useFormStatus } from "react-dom";

import { Button, type ButtonProps } from "./button";

/**
 * A submit button that disables itself while its form is in flight.
 *
 * `useFormStatus` reads the state of the nearest enclosing form, which is why
 * this has to be its own client component: the form itself stays a Server
 * Component, and only this button ships JavaScript. Double submission is the
 * thing being prevented — on a sign-up form that means one account, not two.
 */
export function SubmitButton({
  children,
  pendingLabel,
  ...props
}: ButtonProps & { pendingLabel?: string | undefined }) {
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending} aria-busy={pending} {...props}>
      {pending ? (pendingLabel ?? children) : children}
    </Button>
  );
}
