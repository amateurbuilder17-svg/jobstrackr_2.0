"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Route-level error boundary.
 *
 * Without this file, any thrown render error shows Next's own error screen —
 * unstyled, out of shell, and in production a bare "Application error" with no
 * way back into the site. This keeps the person inside the app and gives them
 * somewhere to go.
 *
 * Client Component by requirement: an error boundary has to run in the browser
 * to catch a client render. It stays tiny for that reason — no icon import, no
 * UI kit, nothing that would land in every route's bundle.
 *
 * `digest` is the hash Next attaches to a server-side error. The message itself
 * is deliberately withheld in production builds, so the digest is the only
 * thread between what the user saw and what the logs recorded — which makes it
 * worth showing, quietly.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Replaced by the reporter once a DSN is configured; until then this is
    // what puts the failure somewhere a person can find it.
    console.error("[route error]", error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-[52ch] flex-col items-start gap-4 px-4 py-16 sm:px-6">
      <h1 className="font-cond text-2xl font-bold tracking-tight text-ink">
        Something went wrong on this page
      </h1>

      <p className="text-ink-2">
        The rest of the site is fine — this page failed to load. Trying again often works, as
        the cause is usually temporary.
      </p>

      <div className="mt-2 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Try again
        </button>
        <Link
          href="/jobs"
          className="rounded-md border border-line px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Browse all jobs
        </Link>
      </div>

      {error.digest ? (
        <p className="mt-4 text-xs text-ink-3">
          Reference <code className="font-mono">{error.digest}</code> — quote this if you report
          it.
        </p>
      ) : null}
    </div>
  );
}
