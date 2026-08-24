import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

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
 * The page never awaits `searchParams`, so the heading and links prerender as
 * static and arrive from the CDN. Only `<Credentials>` awaits them, inside a
 * Suspense boundary — with Cache Components enabled, reading runtime data
 * outside one is a build error, not merely a slower route.
 */
export default function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Welcome back</h1>
        <p className="mt-1 text-sm text-ink-2">Sign in to pick up where you left off.</p>
      </header>

      <Suspense fallback={<FormFallback />}>
        <Credentials searchParams={searchParams} />
      </Suspense>

      <p className="mt-6 text-center text-sm text-ink-2">
        New here?{" "}
        <Link href="/sign-up" className="font-medium text-accent hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}

async function Credentials({ searchParams }: { searchParams: SearchParams }) {
  const { next, error } = await searchParams;
  return <SignInForm next={next} initialError={error} />;
}

/** Matches the form's height so the boundary resolving does not shift the page. */
function FormFallback() {
  return <div className="h-[22rem]" aria-hidden />;
}
