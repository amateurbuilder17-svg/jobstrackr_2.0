import type { ReactNode } from "react";

import { TodayProvider } from "@/components/jobs/today-provider";
import { SessionProvider } from "@/components/session/session-provider";
import { BottomNav } from "./bottom-nav";
import { MenuPanel } from "./menu-panel";
import { Sidebar } from "./sidebar";
import { SiteFooter } from "./site-footer";
import { TopBar } from "./top-bar";

/**
 * The application frame.
 *
 * `pb-16 lg:pb-0` reserves room for the mobile bottom bar. Without it the last
 * card of every list sits underneath the nav — reachable only by
 * overscrolling, which reads as a broken page rather than a missing rule.
 *
 * `SessionProvider` wraps the whole frame rather than only the router outlet,
 * and the difference matters: the top bar's profile button lives above `main`,
 * and it needs the same answer the save buttons below it are already waiting
 * for. One provider, one fetch per page load, shared by both.
 *
 * It is a Client Component wrapping Server Component children, which is fine —
 * `children` is already-rendered output being passed through, not code being
 * pulled into the browser bundle. `Sidebar`, `BottomNav` and `MenuPanel` stay
 * server-rendered for exactly that reason.
 *
 * `MenuPanel` is rendered here, in the frame, rather than inside the drawer
 * that opens it. Its markup is the same list `/menu` renders, and putting it in
 * the layout is what keeps the drawer's client cost to the open/close logic
 * alone instead of the fifty links inside it.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <div className="flex min-h-dvh">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main id="content" className="flex-1 pb-16 lg:pb-0">
            {/* The midnight timer sits above the router outlet so it survives
                client navigation: it is armed once per full page load rather
                than once per route change. */}
            <TodayProvider>{children}</TodayProvider>
          </main>
          <SiteFooter />
        </div>
        <BottomNav />
      </div>
      <MenuPanel />
    </SessionProvider>
  );
}
