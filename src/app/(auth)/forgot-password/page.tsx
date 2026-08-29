import type { Metadata } from "next";
import Link from "next/link";

import { enabledOAuthProviders } from "@/lib/auth/providers";
import { GoogleAuth } from "@/components/auth/google-auth";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = {
  title: "Reset your password",
  robots: { index: false, follow: false },
};

/**
 * Google belongs here more than on any other screen: an account created with
 * Google has no password, so a reset link is the one thing that cannot help
 * the person who ends up here. The page still prerenders — the provider probe
 * is cached, not per-request — so no Suspense boundary is needed.
 */
export default async function ForgotPasswordPage() {
  const { google } = await enabledOAuthProviders();

  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Reset your password</h1>
        <p className="mt-1 text-sm text-ink-2">We will email you a link to choose a new one.</p>
      </header>

      <div className="flex flex-col gap-5">
        {google ? <GoogleAuth /> : null}
        <ForgotPasswordForm />
      </div>

      <p className="mt-6 text-center text-sm text-ink-2">
        <Link href="/sign-in" className="font-medium text-accent hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
