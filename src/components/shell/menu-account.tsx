"use client";

import Link from "next/link";

import { ChevronRightIcon, UserIcon } from "@/components/icons";
import { useSession } from "@/components/session/session-provider";

/**
 * The card at the top of the menu: who you are, or an invitation to sign in.
 *
 * Client-side for the same reason the profile button is — this renders in the
 * shell, on every route, and reading the session on the server to draw it would
 * make every cached page dynamic.
 *
 * The three states are the same three the profile button has, and they are
 * kept visually the same height so the whole list below does not jump when the
 * session resolves.
 */
export function MenuAccount() {
  const { ready, signedIn, identity } = useSession();

  const frame =
    "flex items-center gap-3 rounded-lg border border-line bg-surface-2 px-3 py-3 " +
    "transition-colors duration-(--duration-fast)";

  // Before the session resolves — and forever, for anyone whose browser runs no
  // JavaScript. So this is a working link, not a skeleton: `/profile` is the
  // right destination either way, because middleware sends a guest from there
  // to sign-in. A grey placeholder that never fills in would leave a no-JS
  // visitor with a broken-looking box where their account should be.
  if (!ready) {
    return (
      <Link href="/profile" className={`${frame} hover:border-line-strong`}>
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink-3">
          <UserIcon className="size-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold text-ink">Your account</span>
          <span className="truncate text-xs text-ink-3">Profile, saved jobs and exams</span>
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-ink-3" />
      </Link>
    );
  }

  if (!signedIn) {
    return (
      <Link href="/sign-in" className={`${frame} hover:border-line-strong`}>
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink-2">
          <UserIcon className="size-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold text-ink">Sign in</span>
          <span className="truncate text-xs text-ink-3">
            Save jobs, track exams, get matches
          </span>
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-ink-3" />
      </Link>
    );
  }

  return (
    <Link href="/profile" className={`${frame} hover:border-line-strong`}>
      <span
        className={
          "flex size-11 shrink-0 items-center justify-center rounded-full bg-accent " +
          "text-sm font-semibold tracking-wide text-on-accent"
        }
      >
        {identity?.initials ?? <UserIcon className="size-5" aria-hidden="true" />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-semibold text-ink">
          {identity?.name ?? "Your profile"}
        </span>
        {identity?.email ? (
          <span className="truncate text-xs text-ink-3">{identity.email}</span>
        ) : null}
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-ink-3" />
    </Link>
  );
}
