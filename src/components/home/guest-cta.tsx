import Link from "next/link";

import { ChevronRightIcon } from "@/components/icons";

/**
 * The one thing this page asks a signed-out visitor to do, placed after they
 * have seen what the site holds rather than in front of it.
 *
 * A modal or a top-of-page banner would convert better and would also be the
 * app hiding its own content behind a form — which is what `/welcome` did in
 * the previous version, redirecting every guest away from the home page before
 * they had seen a single job.
 *
 * Rendered only when there is no user. It is a sibling of the personal rows and
 * shares their `getUser()` call, which React caches per request, so the guest
 * branch costs nothing extra.
 */
export function GuestCta() {
  return (
    <section
      className={
        "mt-12 flex flex-col gap-4 rounded-xl border border-accent-line bg-accent-soft/60 " +
        "px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-7"
      }
    >
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-ink">Stop reading every notification</h2>
        <p className="mt-1 max-w-prose text-sm text-ink-2">
          Add your date of birth and qualification once. We check the age limit, the stream and
          the closing date on every job so you do not have to.
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap gap-2">
        <Link
          href="/sign-up"
          className={
            "inline-flex h-10 items-center gap-1 rounded-lg bg-accent px-4 text-sm font-medium " +
            "text-on-accent transition-colors duration-(--duration-fast) hover:bg-accent-hover"
          }
        >
          Create a free account
          <ChevronRightIcon className="size-3.5" />
        </Link>
        <Link
          href="/sign-in"
          className={
            "inline-flex h-10 items-center rounded-lg border border-line bg-surface px-4 " +
            "text-sm font-medium text-ink transition-colors duration-(--duration-fast) " +
            "hover:border-line-strong hover:bg-surface-2"
          }
        >
          Sign in
        </Link>
      </div>
    </section>
  );
}
