import Link from "next/link";

import { SearchIcon } from "@/components/icons";
import { ThemeToggle } from "./theme-toggle";

/**
 * Sticky header. Server-rendered apart from the theme toggle.
 *
 * The brand mark shows only below `lg`, where the sidebar is hidden — repeating
 * it beside a sidebar that already says "JobsTrackr" is noise.
 */
export function TopBar() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur-md">
      <div className="flex h-14 items-center gap-3 px-4 lg:px-6">
        <Link
          href="/"
          className="shrink-0 text-base font-semibold tracking-tight text-ink lg:hidden"
        >
          JobsTrackr
        </Link>

        <Link
          href="/jobs"
          className={
            // `min-w-0` so the field can shrink past its own label. Without it
            // the search link's content sets a floor, and on a 320px screen the
            // theme toggle was pushed off the right edge.
            "ml-auto flex h-9 max-w-md min-w-0 flex-1 items-center gap-2 rounded-md border border-line " +
            "bg-surface px-3 text-sm text-ink-3 transition-colors duration-(--duration-fast) " +
            "hover:border-line-strong hover:text-ink-2 lg:ml-0"
          }
        >
          <SearchIcon className="size-4 shrink-0" />
          <span className="truncate">Search jobs and updates</span>
        </Link>

        <div className="ml-auto flex shrink-0 items-center gap-1 lg:ml-0">
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
