import type { Metadata } from "next";
import { Suspense } from "react";

import { enabledOAuthProviders } from "@/lib/auth/providers";
import { AuthCardSkeleton, AuthFooter, AuthHeader, AuthLink, AuthTabs } from "../auth-ui";
import { GoogleAuth } from "../google-auth";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to track applications, save jobs and get matched.",
  // Credential screens have nothing to rank for and should not compete with
  // the content pages in search results.
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{ next?: string; error?: string }>;

/**
 * The page never awaits `searchParams` itself, so the surrounding layout — the
 * artwork, the editorial column, the card frame — prerenders as static and
 * arrives from the CDN. Only `<Credentials>` awaits them, inside a Suspense
 * boundary; with Cache Components enabled, reading runtime data outside one is
 * a build error rather than merely a slower route.
 *
 * The whole card interior is inside that boundary rather than just the form,
 * and the reason is the tabs: "Sign up" has to carry `next` across, or a
 * visitor bounced out of `/tracker` who decides to register lands on
 * `/profile` afterwards instead of where they were going. Nothing behind the
 * boundary does I/O — `searchParams` is already resolved and the provider
 * probe is `use cache` — so it resolves in the same tick and the skeleton is
 * rarely seen at all.
 */
export default function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<AuthCardSkeleton lines={2} />}>
      <Credentials searchParams={searchParams} />
    </Suspense>
  );
}

async function Credentials({ searchParams }: { searchParams: SearchParams }) {
  const [{ next, error }, providers] = await Promise.all([
    searchParams,
    enabledOAuthProviders(),
  ]);

  return (
    <>
      <AuthTabs active="signin" next={next} />

      <AuthHeader title="Welcome" accent="back" subtitle="Sign in to continue to JobsTrackr." />

      <SignInForm next={next} initialError={error} />

      {/* Google first in importance, second in position: one click against
          three fields, and most returning users took that path originally.
          Hidden rather than disabled when the provider is off — a button that
          always fails is worse than no button. */}
      {providers.google ? <GoogleAuth next={next} /> : null}

      <AuthFooter>
        New to JobsTrackr?
        <AuthLink href={next ? `/sign-up?next=${encodeURIComponent(next)}` : "/sign-up"}>
          Create account
        </AuthLink>
      </AuthFooter>
    </>
  );
}
