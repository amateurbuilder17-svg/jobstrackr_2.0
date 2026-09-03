import type { Metadata } from "next";

import { AuthHeader } from "../auth-ui";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = {
  title: "Choose a new password",
  robots: { index: false, follow: false },
};

/**
 * Reached from the recovery email by way of `/auth/callback`, which exchanges
 * the link's code for a session before redirecting here. So a visitor on this
 * page is already authenticated — which is why the proxy's "signed-in users do
 * not belong on auth pages" rule deliberately skips this route.
 *
 * No tabs and no "back to sign in": both would be dead ends for someone who is
 * already signed in and one field away from finishing.
 */
export default function ResetPasswordPage() {
  return (
    <>
      <AuthHeader
        title="Choose a new"
        accent="password"
        subtitle="You will stay signed in on this device."
      />

      <ResetPasswordForm />
    </>
  );
}
