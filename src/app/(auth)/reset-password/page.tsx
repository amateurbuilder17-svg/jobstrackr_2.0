import type { Metadata } from "next";

import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
};

/**
 * Reached from the recovery email by way of `/auth/callback`, which exchanges
 * the link's code for a session before redirecting here. So a visitor on this
 * page is already authenticated — which is why the middleware's "signed-in
 * users do not belong on auth pages" rule deliberately skips this route.
 */
export default function ResetPasswordPage() {
  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Choose a new password
        </h1>
        <p className="mt-1 text-sm text-ink-2">You will stay signed in on this device.</p>
      </header>

      <ResetPasswordForm />
    </>
  );
}
