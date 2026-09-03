import type { Metadata } from "next";

import { enabledOAuthProviders } from "@/lib/auth/providers";
import { AuthFooter, AuthHeader, AuthLink, BackToSignIn } from "../auth-ui";
import { GoogleAuth } from "../google-auth";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Reset your password",
  robots: { index: false, follow: false },
};

/**
 * Google belongs here more than on any other screen: an account created with
 * Google has no password, so a reset link is the one thing that cannot help
 * the person who ends up here.
 *
 * No Suspense boundary and no tabs — this page reads no search params, and the
 * provider probe is cached rather than per-request, so the whole card
 * prerenders.
 */
export default async function ForgotPasswordPage() {
  const { google } = await enabledOAuthProviders();

  return (
    <>
      <BackToSignIn />

      <AuthHeader
        title="Reset"
        accent="password"
        subtitle="Enter your email address and we will send you a link to choose a new one."
      />

      <ForgotPasswordForm />

      {google ? <GoogleAuth /> : null}

      <AuthFooter>
        Remember your password?
        <AuthLink href="/sign-in">Sign in</AuthLink>
      </AuthFooter>
    </>
  );
}
