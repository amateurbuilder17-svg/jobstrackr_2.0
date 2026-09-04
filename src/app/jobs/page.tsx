import Link from "next/link";
import { Suspense } from "react";

import { FilterBar } from "@/components/filters/filter-bar";
import { JobCardSkeleton } from "@/components/jobs/job-card";
import { InfiniteJobList } from "@/components/jobs/infinite-job-list";
import { listJobs, toJobSort } from "@/lib/db/queries/jobs";
import { PAGE_SIZE } from "@/lib/db/cursor";
import {
  FILTER_GROUPS,
  optionOf,
  labelOf,
  type JobLevel,
  type JobStream,
} from "@/lib/jobs/filters";

export const metadata = {
  title: "Government jobs",
  description:
    "Browse every open government job notification, with deadlines, vacancies and eligibility.",
  alternates: { canonical: "/jobs" },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The jobs list.
 *
 * The page shell never awaits `searchParams`, so it prerenders as static and
 * reaches the browser from the CDN. Only `<Results>` awaits them, inside a
 * Suspense boundary — which is what lets the filters paint immediately while
 * the query is still running.
 *
 * ── The fold ──────────────────────────────────────────────────────────────
 * There is no `<h1>`, no description sentence and no search field here, and all
 * three are deliberate. They cost ~230px at the top of a 375×812 screen which,
 * with a filter block that wrapped to four lines, pushed the first job past
 * 790px: a list of jobs whose first screen contained no jobs.
 *
 * The heading moved to the top bar, which was already showing the section name;
 * the search field moved there too, replacing a link that only led back to this
 * same page. A heading repeating the tab you just tapped, above a link to where
 * you already are, was the least valuable space on the screen.
 *
 * Six rows now sit above the fold. That number is the gate, not a preference.
 */
export default function JobsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-2 lg:px-6 lg:py-6">
      {/* Visually hidden, which keeps the ~230px saving described above while
          still giving the page exactly one level-one heading. Without it this
          route had none at all on desktop: the top bar's title is `lg:hidden`,
          so above `lg` there was nothing for a screen reader to land on. */}
      <h1 className="sr-only">Government jobs</h1>

      {/* Search lives in the top bar on this route — see `TopBar`; only the
          filter row is here. Suspense because it reads useSearchParams, which
          would otherwise opt the whole route out of static rendering. */}
      <Suspense fallback={<div className="h-10" />}>
        <FilterBar groups={FILTER_GROUPS} />
      </Suspense>

      <Suspense fallback={<ResultsSkeleton />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Results({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  const query = one(params.q);
  // Narrowed against the chip lists rather than passed through, so a
  // hand-edited `?level=nonsense` is treated as no filter instead of reaching
  // Postgres as an invalid enum and 500ing the page.
  const level = optionOf(FILTER_GROUPS[0], one(params.level)) as JobLevel | undefined;
  const stream = optionOf(FILTER_GROUPS[1], one(params.stream)) as JobStream | undefined;
  const sector = optionOf(FILTER_GROUPS[2], one(params.sector));
  const state = optionOf(FILTER_GROUPS[3], one(params.state));
  const cursor = one(params.after);
  const sort = toJobSort(one(params.sort));

  const page = await listJobs({
    query,
    state,
    level,
    stream,
    sector,
    sort,
    cursor,
    limit: PAGE_SIZE.list,
  });

  if (page.items.length === 0) {
    // Names what was searched rather than shrugging. "No jobs match those
    // filters" tells someone nothing they did not already know.
    const applied = [
      query ? `“${query}”` : null,
      labelOf(FILTER_GROUPS[0], level),
      labelOf(FILTER_GROUPS[1], stream),
      labelOf(FILTER_GROUPS[2], sector),
      labelOf(FILTER_GROUPS[3], state),
      sort !== "closing" ? (sort === "vacancy" ? "Highest vacancy" : "Newest") : null,
    ]
      .filter(Boolean)
      .join(" · ");

    return (
      <div className="mt-6 rounded-lg border border-dashed border-line px-6 py-12 text-center">
        <p className="font-semibold text-ink">Nothing open{applied ? ` for ${applied}` : ""}</p>
        <p className="mt-1 text-sm text-ink-2">
          Closed listings are not shown here. Try a broader search, or clear the filters.
        </p>
        <Link
          href="/jobs"
          className="mt-4 inline-block text-sm font-semibold text-accent hover:underline"
        >
          Clear all filters
        </Link>
      </div>
    );
  }

  return (
    <InfiniteJobList
      initialItems={page.items}
      initialCursor={page.nextCursor}
      filterParams={{
        q: query,
        state,
        level,
        stream,
        sector,
        sort,
      }}
    />
  );
}

function ResultsSkeleton() {
  return (
    <>
      <div className="mt-2 flex items-center justify-between border-b border-line pb-1.5">
        <div className="skeleton h-3 w-24" />
        <div className="skeleton h-8 w-40 rounded-full" />
      </div>
      <ul className="mt-4 flex flex-col gap-3" aria-busy="true" aria-label="Loading jobs">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i}>
            <JobCardSkeleton variant="card" />
          </li>
        ))}
      </ul>
    </>
  );
}
