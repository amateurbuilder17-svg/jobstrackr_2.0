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
  subtitle,
  href,
  linkLabel = "See all",
  children,
}: {
  title: string;
  /** One line saying what the row is for. Six rows of bare nouns do not. */
  subtitle?: string;
  href?: string;
  linkLabel?: string;
  children: ReactNode;
}) {
  return (
    <section className="mt-12 first:mt-0">
      {/* A ruled header, which is the one piece of ornament this design system
          is entitled to: the subject is government gazettes, and a hairline
          under a heading is what a gazette does. It also does real work — six
          untitled sections down a long page blur into one list, and the rule
          gives the eye somewhere to stop. */}
      <div className="flex items-end justify-between gap-4 border-b border-line pb-2.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
            {/* The accent, at the smallest dose that still registers. Colour is
                otherwise reserved for state in this palette, and a 3px tick
                against a heading cannot be mistaken for a status. */}
            <span aria-hidden className="h-4 w-[3px] shrink-0 rounded-full bg-accent" />
            <span className="truncate">{title}</span>
          </h2>
          {subtitle ? <p className="mt-1 text-xs text-ink-3">{subtitle}</p> : null}
        </div>

        {href ? (
          <Link
            href={href}
            className={
              "group inline-flex shrink-0 items-center gap-0.5 text-sm font-medium text-accent " +
              "hover:underline"
            }
          >
            {linkLabel}
            <ChevronRightIcon className="size-3.5 transition-transform duration-(--duration-fast) group-hover:translate-x-0.5" />
          </Link>
        ) : null}
      </div>

      <div className="mt-4">{children}</div>
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
