"use client";

import type { ReactNode } from "react";

import { useSession } from "@/components/session/session-provider";

/**
 * Publishes the session as data attributes, so the list inside can stay a
 * Server Component.
 *
 * The admin row is the only item in the menu that must not be shown to
 * everyone. The obvious implementation — make that row a Client Component that
 * reads the session — pulls its icon and label into the browser bundle, and
 * invites the next conditional row to do the same until the whole list is
 * client-side.
 *
 * This publishes one attribute instead, and the row hides itself with a CSS
 * variant. The wrapper is the only JavaScript involved, the fifty rows inside
 * it are server-rendered HTML, and adding a second conditional row later costs
 * one more class rather than one more component.
 *
 * `data-admin` is a UI hint and nothing more. `/admin` is guarded by
 * middleware, by `requireUser`, and by RLS on every table it reads — hiding the
 * link is politeness, not access control, and forging the attribute in devtools
 * gets you a redirect.
 */
export function MenuScope({ children }: { children: ReactNode }) {
  const { ready, signedIn, identity } = useSession();

  return (
    <div
      className="group/session"
      // "no" until proven otherwise. The alternative — showing the row while
      // the session resolves and hiding it a moment later — flashes an Admin
      // link at every visitor on every page load.
      data-admin={ready && signedIn && identity?.isAdmin ? "yes" : "no"}
    >
      {children}
    </div>
  );
}
