"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { useSessionRecheck } from "@/components/session/session-provider";
import { closeMenu } from "./menu-store";

/**
 * The one place that notices a client navigation.
 *
 * Two things in the shell need that signal, and neither may read it for itself:
 *
 *   - **The session store** has to re-check who is signed in. Signing in ends
 *     with a server-side `redirect`, which the App Router performs as a client
 *     navigation — the shell survives it, so the provider never remounts and
 *     would go on believing the visitor is the guest it met on the first page,
 *     never merging their shortlist and still writing saves to localStorage.
 *   - **The drawer** has to close. A link inside it navigates, and the panel
 *     must not still be sitting over the page it navigated to.
 *
 * The reason this is a component rather than two `usePathname()` calls where
 * they are needed: that hook reads URL data, and under Cache Components a
 * client hook doing that outside a `<Suspense>` boundary blocks prerendering
 * for every route carrying the shell. Both callers live in the root layout, so
 * both would have poisoned all of it.
 *
 * It went unnoticed for as long as every dynamic route had
 * `generateStaticParams` — with all params known, there is no fallback shell to
 * prerender. The first route without them, `/syllabus/[slug]`, failed the build
 * on it twice: once for the session provider and once for the drawer.
 *
 * Renders nothing, so its Suspense fallback is nothing too.
 */
export function RouteWatcher() {
  const pathname = usePathname();
  const recheck = useSessionRecheck();

  useEffect(() => {
    closeMenu();
    recheck();
  }, [pathname, recheck]);

  return null;
}
