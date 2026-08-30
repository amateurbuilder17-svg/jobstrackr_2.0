import type { Metadata } from "next";

import { MenuList } from "@/components/shell/menu-list";

/**
 * The menu, as a page.
 *
 * This is where the menu button points before JavaScript has run, and where it
 * still points for anyone whose browser never runs any. It is not a fallback in
 * the apologetic sense — it is the same list, with room for the one-line hints
 * the drawer has to drop, and it is linkable and back-buttonable in a way a
 * drawer is not.
 *
 * Statically rendered. Nothing here reads the session on the server; the
 * account card and the admin row fill themselves in on the client, exactly as
 * they do in the drawer.
 */
export const metadata: Metadata = {
  title: "Menu",
  description: "Everything in JobsTrackr: your profile, tools, support and legal pages.",
  // Not a page anyone should reach from a search engine — it is navigation, and
  // the destinations it lists are indexed on their own terms.
  robots: { index: false, follow: true },
};

export default function MenuPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
      <h1 className="px-3 pb-5 text-2xl font-bold tracking-tight text-ink">Menu</h1>
      <MenuList />
    </div>
  );
}
