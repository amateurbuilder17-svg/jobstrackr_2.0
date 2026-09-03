"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { SearchIcon } from "@/components/icons";
import { SearchField } from "@/components/filters/search-field";
import { NAV_ITEMS, isActive } from "@/lib/navigation";
import { MenuButton } from "./menu-button";
import { ProfileButton } from "./profile-button";
import { ThemeToggle } from "./theme-toggle";

/**
 * Sticky header.
 *
 * Below `lg` this bar is the page's title bar: it names where you are, because
 * the pages themselves no longer carry an `<h1>` that repeats the navigation
 * item you just tapped. On a 375×812 screen that heading and its description
 * cost ~180px at the top of every list — enough to push the first row of a job
 * list below the fold.
 *
 * The search affordance is a link to `/jobs`, and it is hidden on routes that
 * carry their own search field. Two search inputs stacked above each other is
 * not twice as findable; it is one of them wasting a row of height and both of
 * them raising the question of which one is the real one.
 *
 * ## The width, which is the hard part below `lg`
 *
 * The bar has to hold, in order: a menu button, a title or a search field, a
 * theme toggle and an avatar. Two of those are new and each is 36–40px, so
 * about 80px came out of a 320px screen's budget for the middle.
 *
 * The search *link* gives up its label there and becomes an icon — "Search jobs
 * and updates" is a nicety, and a nicety is what should go first. The search
 * *field* keeps its input, because a field with no room to type in is not a
 * field. What lets it survive the squeeze is the `min-w-0` that was already
 * there: a flex child's automatic minimum width is its content, so without it
 * the field sets a floor, the bar grows wider than the viewport, and the whole
 * page scrolls sideways.
 */

/**
 * Routes that search rather than link to search.
 *
 * On these the live field replaces the title and the link both. Stacking a
 * dead search link in the bar above a real search field on the page cost ~48px
 * of a 375×812 screen to ask the same question twice.
 *
 * Matched exactly, not by prefix, and that distinction is load-bearing. This
 * bar lives in the root layout, so anything it renders is rendered by every
 * route. `SearchField` reads `useSearchParams`, and a prefix match put that
 * hook on `/jobs/[slug]` too — all ~2,700 statically generated job pages, each
 * of which then failed to prerender with a blocking-client-hook error. A detail
 * page is not a search page; it gets the title and the link.
 */
const SEARCHES_HERE = new Set(["/jobs", "/updates"]);

export function TopBar() {
  const pathname = usePathname();

  const current = NAV_ITEMS.find((item) => isActive(pathname, item.href));
  const searchesHere = SEARCHES_HERE.has(pathname);
  const isHome = pathname === "/";

  return (
    <header
      data-shell="top-bar"
      className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md"
    >
      <div className="flex h-13 items-center gap-2 px-4 sm:gap-3 lg:px-6">
        <MenuButton />

        {searchesHere ? (
          // The bar *is* the search field here. `min-w-0` so it can shrink past
          // its own placeholder; without it the field sets a floor and on a
          // 320px screen the theme toggle is pushed off the right edge.
          <div className="min-w-0 flex-1 lg:max-w-lg">
            <Suspense
              fallback={<div className="h-9 rounded-md border border-line bg-surface" />}
            >
              {pathname === "/updates" ? (
                <SearchField
                  placeholder="Search admit cards, results, exam names"
                  label="Search exam updates"
                />
              ) : (
                <SearchField />
              )}
            </Suspense>
          </div>
        ) : (
          <>
            {/* The brand shows only below `lg`, where the sidebar is hidden.
                Repeating it beside a sidebar that already says "JobsTrackr" is
                noise — and on a section page the section's own name is the more
                useful thing to put here, since the pages no longer carry an
                `<h1>` that repeats the tab you just tapped. */}
            <div className="min-w-0 shrink lg:hidden">
              {current && current.href !== "/" ? (
                // A `<span>`, not an `<h1>`. This is `lg:hidden`, so on desktop
                // it is display:none and cannot serve as anyone's page heading —
                // while on mobile it sat *alongside* the real `<h1>` on every
                // detail page, giving /jobs/[slug], /saved and /calendar two
                // level-one headings each. The pages own their headings; this
                // bar names the section you are in, which is navigation.
                <span className="truncate text-base font-bold tracking-tight text-ink">
                  {current.label}
                </span>
              ) : (
                <Link href="/" className="text-base font-bold tracking-tight text-ink">
                  JobsTrackr
                </Link>
              )}
            </div>

            {!isHome && (
              <Link
                href="/jobs"
                aria-label="Search jobs and updates"
                className={
                  "ml-auto flex h-9 min-w-0 shrink-0 items-center justify-center gap-2 rounded-md " +
                  "border border-line bg-surface text-sm text-ink-3 " +
                  "transition-colors duration-(--duration-fast) hover:border-line-strong " +
                  "hover:text-ink-2 max-sm:size-9 sm:max-w-md sm:flex-1 sm:shrink sm:px-3 lg:ml-0"
                }
              >
                <SearchIcon className="size-4 shrink-0" />
                <span className="truncate max-sm:hidden">Search jobs and updates</span>
              </Link>
            )}
          </>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ThemeToggle />
          <ProfileButton />
        </div>
      </div>
    </header>
  );
}
