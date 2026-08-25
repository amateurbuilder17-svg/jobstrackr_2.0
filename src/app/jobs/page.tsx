import Link from "next/link";
import { Suspense } from "react";

import { FilterBar, SortToggle, type FilterGroup } from "@/components/filters/filter-bar";
import { JobCard, JobCardSkeleton } from "@/components/jobs/job-card";
import { listJobs, toJobSort } from "@/lib/db/queries/jobs";
import { PAGE_SIZE } from "@/lib/db/cursor";

export const metadata = {
  title: "Government jobs",
  description:
    "Browse every open government job notification, with deadlines, vacancies and eligibility.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Grouped, so the row can say what a chip *is*. Rendered as one scrolling line
 * rather than one wrapped block per group — see `FilterBar`.
 */
const FILTER_GROUPS: FilterGroup[] = [
  {
    param: "tag",
    label: "Qualification or sector",
    options: [
      { label: "Graduate", value: "graduate" },
      { label: "Class 10", value: "class-10" },
      { label: "Engineering", value: "engineering" },
      { label: "Banking", value: "banking" },
      { label: "Railway", value: "railway" },
      { label: "Central govt", value: "central-govt" },
    ],
  },
  {
    param: "state",
    label: "State",
    options: [
      { label: "All India", value: "All India" },
      { label: "Delhi", value: "Delhi" },
      { label: "Odisha", value: "Odisha" },
      { label: "Maharashtra", value: "Maharashtra" },
      { label: "Bihar", value: "Bihar" },
      { label: "Tamil Nadu", value: "Tamil Nadu" },
    ],
  },
];

/** Closing-soonest is the default, so it is the absence of `?sort=`. */
const JOB_SORTS = [
  { value: "closing", label: "Closing soon" },
  { value: "newest", label: "Newest" },
] as const;

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
  const tag = one(params.tag);
  const state = one(params.state);
  const cursor = one(params.after);
  const sort = toJobSort(one(params.sort));

  const page = await listJobs({ query, tag, state, sort, cursor, limit: PAGE_SIZE.list });

  if (page.items.length === 0) {
    // Names what was searched rather than shrugging. "No jobs match those
    // filters" tells someone nothing they did not already know.
    const applied = [query ? `“${query}”` : null, tag, state].filter(Boolean).join(" · ");

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

  // Carry the current filters onto the next page, or "Load more" silently drops
  // them and pages through an entirely different result set.
  const nextParams = new URLSearchParams();
  if (query) nextParams.set("q", query);
  if (tag) nextParams.set("tag", tag);
  if (state) nextParams.set("state", state);
  if (sort === "newest") nextParams.set("sort", "newest");
  if (page.nextCursor) nextParams.set("after", page.nextCursor);

  return (
    <>
      <div className="mt-2 flex items-center justify-between gap-3 border-b border-line pb-1.5">
        {/* Announced politely so a screen-reader user hears the list change
            after a filter, rather than having to go looking for it. */}
        <p aria-live="polite" className="tabular text-xs text-ink-3">
          {page.nextCursor
            ? `${String(page.items.length)}+ open jobs`
            : `${String(page.items.length)} open ${page.items.length === 1 ? "job" : "jobs"}`}
        </p>
        <Suspense fallback={<div className="h-8" />}>
          <SortToggle options={JOB_SORTS} label="Sort jobs by" />
        </Suspense>
      </div>

      {/* A bordered box with hairline-separated rows, not a stack of floating
          cards. The list reads as one table of records. */}
      <ul className="overflow-hidden rounded-lg border border-line border-b-0">
        {page.items.map((job) => (
          <li key={job.id}>
            <JobCard job={job} />
          </li>
        ))}
      </ul>

      {page.nextCursor ? (
        <div className="mt-4 flex justify-center">
          {/* A real link, not a button: it works without JavaScript, the next
              page is shareable, and Next still navigates it client-side. */}
          <Link
            href={`/jobs?${nextParams.toString()}`}
            scroll={false}
            className={
              "inline-flex h-10 items-center rounded-md border border-line bg-surface px-5 " +
              "text-sm font-medium text-ink transition-colors duration-(--duration-fast) " +
              "hover:border-line-strong hover:bg-surface-2"
            }
          >
            Load more
          </Link>
        </div>
      ) : (
        <p className="mt-4 text-center text-xs text-ink-3">That is every matching job.</p>
      )}
    </>
  );
}

function ResultsSkeleton() {
  return (
    <>
      <div className="mt-2 flex items-center justify-between border-b border-line pb-1.5">
        <div className="skeleton h-3 w-24" />
        <div className="skeleton h-8 w-40 rounded-full" />
      </div>
      <ul
        className="overflow-hidden rounded-lg border border-line border-b-0"
        aria-busy="true"
        aria-label="Loading jobs"
      >
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i}>
            <JobCardSkeleton />
          </li>
        ))}
      </ul>
    </>
  );
}
