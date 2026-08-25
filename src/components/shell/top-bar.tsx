"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { SearchIcon } from "@/components/icons";
import { SearchField } from "@/components/filters/search-field";
import { NAV_ITEMS, isActive } from "@/lib/navigation";
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

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="flex h-13 items-center gap-3 px-4 lg:px-6">
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
                <h1 className="truncate text-base font-bold tracking-tight text-ink">
                  {current.label}
                </h1>
              ) : (
                <Link href="/" className="text-base font-bold tracking-tight text-ink">
                  JobsTrackr
                </Link>
              )}
            </div>

            <Link
              href="/jobs"
              className={
                "ml-auto flex h-9 max-w-md min-w-0 flex-1 items-center gap-2 rounded-md border border-line " +
                "bg-surface px-3 text-sm text-ink-3 transition-colors duration-(--duration-fast) " +
                "hover:border-line-strong hover:text-ink-2 lg:ml-0"
              }
            >
              <SearchIcon className="size-4 shrink-0" />
              <span className="truncate">Search jobs and updates</span>
            </Link>
          </>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
