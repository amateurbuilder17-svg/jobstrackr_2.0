"use client";

import { useActionState } from "react";

import { KeyIcon, SignOutIcon } from "@/components/icons";
import { useSession } from "@/components/session/session-provider";
import { resetOwnPasswordAction, signOutAction } from "@/lib/auth/actions";
import { EMPTY_FORM_STATE } from "@/lib/auth/form-state";

/**
 * Reset password and sign out.
 *
 * Hidden entirely for guests — "Sign out" on a menu belonging to someone who is
 * not signed in is not a harmless extra row, it is a control that implies a
 * session they do not have. Rendered as nothing until the session resolves, for
 * the same reason: a sign-out button that appears and then vanishes is worse
 * than one that arrives a beat late.
 *
 * Both are forms rather than links. Signing out is a state change, and as a GET
 * link it would be followed by any prefetcher that touched the page — signing
 * the user out without them clicking anything.
 */

const ROW =
  "flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left " +
  "transition-colors duration-(--duration-fast) hover:bg-surface-2 " +
  "disabled:pointer-events-none disabled:opacity-60";

export function MenuSessionActions() {
  const { ready, signedIn, identity } = useSession();
  const [resetState, resetAction, resetting] = useActionState(
    resetOwnPasswordAction,
    EMPTY_FORM_STATE,
  );

  if (!ready || !signedIn) return null;

  // Someone who signed in with Google has no password to reset, and offering to
  // reset one implies they have something they do not. The flow behind both
  // labels is the same — the link sets whatever is there, or is not.
  //
  // Defaults to the reset wording when identity has not resolved: `signedIn` is
  // true a beat before it arrives, and of the two labels that could flicker
  // there, the one that was always shown is the safer thing to show first.
  const hasPassword = identity?.hasPassword ?? true;

  return (
    <div className="flex flex-col gap-0.5 border-t border-line pt-2">
      <form action={resetAction}>
        <button type="submit" disabled={resetting} aria-busy={resetting} className={ROW}>
          <KeyIcon className="size-[1.15rem] shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">
              {resetting ? "Sending…" : hasPassword ? "Reset password" : "Set a password"}
            </span>
            <span className="block truncate text-xs text-ink-3">
              {hasPassword
                ? "We email you a link to set a new one"
                : "Sign in with an email and password too"}
            </span>
          </span>
        </button>
      </form>

      {/* `aria-live` so the outcome is announced rather than only shown. This
          form has no field to attach an error to, so without it a screen
          reader user gets no confirmation that anything happened at all. */}
      {resetState.message ? (
        <p
          aria-live="polite"
          className={"px-3 pb-1 text-xs " + (resetState.ok ? "text-accent" : "text-critical")}
        >
          {resetState.message}
        </p>
      ) : null}

      <form action={signOutAction}>
        <button type="submit" className={`${ROW} text-critical`}>
          <SignOutIcon className="size-[1.15rem] shrink-0" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">Sign out</span>
        </button>
      </form>
    </div>
  );
}
