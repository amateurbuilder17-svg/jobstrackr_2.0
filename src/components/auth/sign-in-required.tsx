import Link from "next/link";
import type { ComponentType } from "react";

import { ChevronRightIcon, LockIcon } from "@/components/icons";

/**
 * What a signed-out visitor sees on a page whose contents belong to an account.
 *
 * The alternative — and what this replaces — is bouncing them to `/sign-in`
 * before the route renders. That is correct about access and wrong about
 * everything else: a tap on "My Exams" answered with a password field never
 * says *why*, reads as the app having logged them out, and loses the page they
 * asked for behind a `next` parameter they never see. People bounce off it.
 *
 * So the route still renders, and renders this instead of the data: the name of
 * the thing they asked for, one sentence on what an account buys them there,
 * and the way in. No data is read and no query runs on this path, so a guest
 * costs the same as a redirect did — the gate is in front of every call, not
 * behind it.
 *
 * `next` is carried through to both links so signing in or signing up returns
 * them to the page they wanted rather than to a generic landing.
 */
export interface SignInRequiredProps {
  /** The feature, named as the person would name it — "My Exams", not "the tracker". */
  title: string;
  /** One sentence: what this page does for them once they are in. */
  description: string;
  /** Where to send them back to afterwards. A path on this site. */
  next: string;
  /** Defaults to a lock; pass the page's own icon where it has one. */
  icon?: ComponentType<{ className?: string }>;
}

export function SignInRequired({
  title,
  description,
  next,
  icon: Icon = LockIcon,
}: SignInRequiredProps) {
  const query = `?next=${encodeURIComponent(next)}`;

  return (
    <section className="mx-auto mt-6 max-w-md rounded-2xl border border-line bg-surface px-6 py-10 text-center shadow-xs sm:px-8 sm:py-12">
      <div
        className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-line bg-logo-plate shadow-xs"
        aria-hidden="true"
      >
        <Icon className="size-6 text-brand" />
      </div>

      <h2 className="mt-5 text-lg font-bold tracking-tight text-ink">{title}</h2>

      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-ink-2">{description}</p>

      <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:justify-center">
        <Link
          href={`/sign-in${query}`}
          className={
            "inline-flex h-11 items-center justify-center gap-1 rounded-xl bg-accent px-5 " +
            "text-sm font-semibold text-on-accent shadow-xs " +
            "transition-colors duration-(--duration-fast) hover:bg-accent-hover"
          }
        >
          Sign in
          <ChevronRightIcon className="size-3.5" aria-hidden="true" />
        </Link>
        <Link
          href={`/sign-up${query}`}
          className={
            "inline-flex h-11 items-center justify-center rounded-xl border border-line " +
            "bg-surface px-5 text-sm font-medium text-ink " +
            "transition-colors duration-(--duration-fast) hover:border-line-strong hover:bg-surface-2"
          }
        >
          Create a free account
        </Link>
      </div>

      <p className="mt-5 text-xs text-ink-3">Free, and takes under a minute.</p>
    </section>
  );
}
