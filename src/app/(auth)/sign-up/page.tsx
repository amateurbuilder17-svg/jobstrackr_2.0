import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = {
  title: "Create an account",
  description: "Create a JobsTrackr account to save jobs and track applications.",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{ next?: string }>;

/** Static shell, runtime `next` read inside Suspense — see the sign-in page. */
export default function SignUpPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Create your account</h1>
        <p className="mt-1 text-sm text-ink-2">
          Save jobs, track deadlines, and see what you are eligible for.
        </p>
      </header>

      <Suspense fallback={<FormFallback />}>
        <Credentials searchParams={searchParams} />
      </Suspense>

      <p className="mt-6 text-center text-sm text-ink-2">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}

async function Credentials({ searchParams }: { searchParams: SearchParams }) {
  const { next } = await searchParams;
  return <SignUpForm next={next} />;
}

function FormFallback() {
  return <div className="h-[26rem]" aria-hidden />;
}
