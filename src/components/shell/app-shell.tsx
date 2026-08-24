import type { ReactNode } from "react";

import { BottomNav } from "./bottom-nav";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

/**
 * The application frame.
 *
 * `pb-16 lg:pb-0` reserves room for the mobile bottom bar. Without it the last
 * card of every list sits underneath the nav — reachable only by
 * overscrolling, which reads as a broken page rather than a missing rule.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="content" className="flex-1 pb-16 lg:pb-0">
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
