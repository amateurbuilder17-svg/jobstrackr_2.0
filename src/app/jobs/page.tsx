import Link from "next/link";
import { Suspense } from "react";

import { FilterChips } from "@/components/jobs/filter-chips";
import { JobCard, JobCardSkeleton } from "@/components/jobs/job-card";
import { SearchField } from "@/components/jobs/search-field";
import { listJobs } from "@/lib/db/queries/jobs";
import { PAGE_SIZE } from "@/lib/db/cursor";

export const metadata = {
  title: "Government jobs",
  description:
    "Browse every open government job notification, with deadlines, vacancies and eligibility.",
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const TAG_FILTERS = [
  { label: "Graduate", value: "graduate" },
  { label: "Class 10", value: "class-10" },
  { label: "Engineering", value: "engineering" },
  { label: "Banking", value: "banking" },
  { label: "Railway", value: "railway" },
  { label: "Central govt", value: "central-govt" },
];

const STATE_FILTERS = [
  { label: "All India", value: "All India" },
  { label: "Delhi", value: "Delhi" },
  { label: "Odisha", value: "Odisha" },
  { label: "Maharashtra", value: "Maharashtra" },
  { label: "Bihar", value: "Bihar" },
  { label: "Tamil Nadu", value: "Tamil Nadu" },
];

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * The page shell never awaits `searchParams`, so it prerenders as static and
 * reaches the browser from the CDN. Only `<Results>` awaits them, inside a
 * Suspense boundary — which is what lets the header, search field and filters
 * paint immediately while the query is still running.
 *
 * That is the progressive-loading story in one structural decision, rather than
 * a spinner bolted on afterwards.
 */
export default function JobsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 lg:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Government jobs</h1>
      <p className="mt-1 text-sm text-ink-2">
        Every open notification, newest first. Filters and search are shareable — they live in
        the URL.
      </p>

      {/* Suspense around the client controls too: they read useSearchParams,
          which would otherwise opt the whole route out of static rendering. */}
      <div className="mt-6 flex flex-col gap-3">
        <Suspense fallback={<div className="h-10 rounded-md border border-line bg-surface" />}>
          <SearchField />
        </Suspense>
        <Suspense fallback={<div className="h-7" />}>
          <FilterChips param="tag" label="Filter by category" options={TAG_FILTERS} />
        </Suspense>
        <Suspense fallback={<div className="h-7" />}>
          <FilterChips param="state" label="Filter by state" options={STATE_FILTERS} />
        </Suspense>
      </div>

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

  const page = await listJobs({ query, tag, state, cursor, limit: PAGE_SIZE.list });

  if (page.items.length === 0) {
    return (
      <div className="mt-8 rounded-lg border border-dashed border-line px-6 py-12 text-center">
        <p className="font-medium text-ink">No jobs match those filters</p>
        <p className="mt-1 text-sm text-ink-2">
          Try a broader search, or clear the filters to see everything.
        </p>
        <Link
          href="/jobs"
          className="mt-4 inline-block text-sm font-medium text-accent hover:underline"
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
  if (page.nextCursor) nextParams.set("after", page.nextCursor);

  return (
    <>
      <ul className="mt-6 flex flex-col gap-3">
        {page.items.map((job) => (
          <li key={job.id}>
            <JobCard job={job} />
          </li>
        ))}
      </ul>

      {page.nextCursor ? (
        <div className="mt-6 flex justify-center">
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
        <p className="mt-6 text-center text-xs text-ink-3">That is every matching job.</p>
      )}
    </>
  );
}

function ResultsSkeleton() {
  return (
    <ul className="mt-6 flex flex-col gap-3" aria-busy="true" aria-label="Loading jobs">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i}>
          <JobCardSkeleton />
        </li>
      ))}
    </ul>
  );
}
