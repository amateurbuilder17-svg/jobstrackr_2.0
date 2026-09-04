import type { Metadata } from "next";
import { Suspense } from "react";

import { enabledOAuthProviders } from "@/lib/auth/providers";
import { AuthCardSkeleton, AuthFooter, AuthHeader, AuthLink, AuthTabs } from "../auth-ui";
import { GoogleAuth } from "../google-auth";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = {
  title: "Create an account",
  description: "Create a JobsTrackr account to save jobs and track applications.",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{ next?: string }>;

/** Static layout, runtime `next` read inside Suspense — see the sign-in page. */
export default function SignUpPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<AuthCardSkeleton lines={3} />}>
      <Credentials searchParams={searchParams} />
    </Suspense>
  );
}

async function Credentials({ searchParams }: { searchParams: SearchParams }) {
  const [{ next }, providers] = await Promise.all([searchParams, enabledOAuthProviders()]);

  return (
    <>
      <AuthTabs active="signup" next={next} />

      <AuthHeader
        title="Create an"
        accent="account"
        subtitle="Start tracking government jobs and exam updates."
      />

      <SignUpForm next={next} />

      {providers.google ? (
        <GoogleAuth next={next} label="Sign up with Google" text="signup_with" />
      ) : null}

      <AuthFooter>
        Already have an account?
        <AuthLink href={next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in"}>
          Sign in
        </AuthLink>
      </AuthFooter>
    </>
  );
}
