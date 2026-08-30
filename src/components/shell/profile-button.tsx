"use client";

import Link from "next/link";

import { UserIcon } from "@/components/icons";
import { useSession } from "@/components/session/session-provider";

/**
 * The profile button, top right, below `lg`.
 *
 * Three states, and the middle one is the reason this is a Client Component
 * rather than a server-rendered avatar:
 *
 *   1. **Not asked yet** — the shell has painted from cache and `/api/session`
 *      has not answered. Renders an empty circle of the final size.
 *   2. **Guest** — a user glyph linking to sign-in.
 *   3. **Signed in** — initials linking to the profile.
 *
 * Rendering the initials on the server would read cookies during the render of
 * the root layout, which under Cache Components makes every page that carries
 * the shell dynamic. That is 2,700 statically generated job pages turned into
 * per-request function invocations to draw two letters — the exact regression
 * this architecture exists to prevent. The name arrives with the saved-job ids,
 * on the one request the session already makes.
 *
 * Every state is the same 36px circle. The size is fixed in all three so the
 * top bar does not reflow when the session resolves — a placeholder that
 * changes size is a layout shift on every page load, which is worse than
 * having no avatar at all.
 */
export function ProfileButton() {
  const { ready, signedIn, identity } = useSession();

  const shared =
    "inline-flex size-9 shrink-0 items-center justify-center rounded-full border " +
    "transition-colors duration-(--duration-fast) lg:hidden";

  if (!ready) {
    return (
      <span
        aria-hidden="true"
        className={`${shared} border-line bg-surface-2`}
        // Not a link and not focusable. A control that changes where it goes
        // half a second after it becomes tabbable is a trap for anyone
        // navigating by keyboard.
      />
    );
  }

  if (!signedIn) {
    return (
      <Link
        href="/sign-in"
        aria-label="Sign in"
        className={`${shared} border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink`}
      >
        <UserIcon className="size-[1.1rem]" />
      </Link>
    );
  }

  const initials = identity?.initials;

  return (
    <Link
      href="/profile"
      // The accessible name is the destination, not the initials. "PD" read
      // aloud is two letters; "Your profile, Prithwish Das" is what the control
      // actually does and for whom.
      aria-label={identity?.name ? `Your profile, ${identity.name}` : "Your profile"}
      className={
        `${shared} border-transparent bg-accent text-on-accent hover:bg-accent-hover ` +
        "text-2xs font-semibold tracking-wide"
      }
    >
      {initials ?? <UserIcon className="size-[1.1rem]" aria-hidden="true" />}
    </Link>
  );
}
