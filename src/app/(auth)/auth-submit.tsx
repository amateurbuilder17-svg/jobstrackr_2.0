"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

import styles from "./auth.module.css";

/**
 * The card's primary button.
 *
 * `useFormStatus` reads the enclosing form's pending state, which is why this
 * is the one part of the form that has to be a Client Component — the form
 * element itself, and everything else inside it, stays server-rendered.
 *
 * What it buys is one account rather than two. A double-tapped sign-up posts
 * twice, and the second post is a duplicate registration; disabling for the
 * duration of the flight is the whole of the fix. `aria-busy` says the same
 * thing to a screen reader, which otherwise gets no signal that anything
 * happened between the tap and the redirect.
 */
export function AuthSubmit({
  children,
  pendingLabel,
}: {
  children: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className={styles.submit} disabled={pending} aria-busy={pending}>
      <span>{pending ? pendingLabel : children}</span>
      {/* The arrow leaves while the form is in flight: an arrow that slides on
          hover is an invitation, and there is nothing left to invite. */}
      {pending ? null : (
        <svg
          className={styles.submitArrow}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <line x1="5" y1="12" x2="19" y2="12" />
          <polyline points="12 5 19 12 12 19" />
        </svg>
      )}
    </button>
  );
}

/**
 * The Google button, which posts to a different action in a different form and
 * so needs its own pending state. Same reasoning: an OAuth redirect takes a
 * visible moment, and a button that looks untouched during it gets tapped
 * again.
 */
export function SocialSubmit({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" className={styles.social} disabled={pending} aria-busy={pending}>
      {children}
    </button>
  );
}
