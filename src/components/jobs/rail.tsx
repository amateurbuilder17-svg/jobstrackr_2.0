import type { ReactNode } from "react";

import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";
import { cn } from "@/lib/cn";

/**
 * A titled section on the home page.
 *
 * Two layouts, one component. `list` stacks rows as a bordered table, which is
 * how a set of deadlines should read; `rail` scrolls sideways with CSS
 * scroll-snap, which is how a browsable set of options should.
 *
 * The old home page built its rails from scroll handlers, ref arithmetic,
 * `scrollBy` calls and a row of pagination dots kept in React state — roughly
 * 90 lines of client code per row, times five rows. `snap-x snap-mandatory` on
 * an `overflow-x-auto` container is the same interaction, in the stylesheet,
 * with nothing shipped to the browser.
 */
export function HomeSection({
  title,
  href,
  linkLabel = "See all",
  children,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-10 first:mt-0">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {href ? (
          <Link
            href={href}
            className="inline-flex shrink-0 items-center gap-0.5 text-sm font-medium text-accent hover:underline"
          >
            {linkLabel}
            <ChevronRightIcon className="size-3.5" />
          </Link>
        ) : null}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Hairline-separated rows, as one aligned table of records. */
export function RowList({ children }: { children: ReactNode }) {
  return (
    <ul className="overflow-hidden rounded-lg border border-line border-b-0">{children}</ul>
  );
}

/** A sideways-scrolling strip. The page body must never scroll with it. */
export function Rail({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <ul
      className={cn(
        "-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 lg:mx-0 lg:px-0",
        "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {children}
    </ul>
  );
}

export function RailItem({ children }: { children: ReactNode }) {
  return <li className="w-64 shrink-0 snap-start">{children}</li>;
}
