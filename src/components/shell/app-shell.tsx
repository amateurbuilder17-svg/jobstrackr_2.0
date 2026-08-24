import type { ReactNode } from "react";

import { SavedProvider } from "@/components/saved/saved-provider";
import { BottomNav } from "./bottom-nav";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";

/**
 * The application frame.
 *
 * `pb-16 lg:pb-0` reserves room for the mobile bottom bar. Without it the last
 * card of every list sits underneath the nav — reachable only by
 * overscrolling, which reads as a broken page rather than a missing rule.
 *
 * `SavedProvider` sits here, above the router outlet, so it survives client
 * navigation: the saved-ids fetch happens once per full page load rather than
 * once per route change. It is a Client Component wrapping Server Component
 * children, which is fine — `children` is already-rendered output being passed
 * through, not code being pulled into the browser bundle.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="content" className="flex-1 pb-16 lg:pb-0">
          <SavedProvider>{children}</SavedProvider>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
