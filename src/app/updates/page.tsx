import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { FilterChips } from "@/components/filters/filter-chips";
import { UpdateCardSkeleton } from "@/components/updates/update-card";
import { InfiniteUpdateList } from "@/components/updates/infinite-update-list";
import { listExamUpdates, toUpdateSort } from "@/lib/db/queries/exam-updates";
import { PAGE_SIZE } from "@/lib/db/cursor";
import { CATEGORY_FILTERS, type UpdateCategory } from "@/lib/updates/categories";

export const metadata: Metadata = {
  title: "Exam updates",
  description:
    "Admit cards, results, answer keys and exam dates for Indian government exams, newest first.",
  alternates: { canonical: "/updates" },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const UPDATE_SORTS = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
] as const;

/**
 * The exam updates feed.
 *
 * The page shell never awaits `searchParams`, so it prerenders static and comes
 * from the CDN; only `<Results>` reads them, inside Suspense. Same structure as
 * /jobs, and for the same reason — the filters and heading paint immediately
 * while the query runs.
 */
export default function UpdatesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-2 lg:px-6 lg:py-6">
      {/* Visually hidden, for the same reason as /jobs: the top bar's section
          title is `lg:hidden`, so without this the route had no level-one
          heading at all above `lg`. */}
      <h1 className="sr-only">Exam updates</h1>

      {/* Search lives in the top bar on this route — see `TopBar`. Suspense
          because these read useSearchParams, which would otherwise opt the
          whole route out of static rendering. */}
      <Suspense fallback={<div className="h-10" />}>
        <FilterChips param="category" label="Filter by type" options={CATEGORY_FILTERS} />
      </Suspense>

      <Suspense fallback={<ResultsSkeleton />}>
        <Results searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Results({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;

  const category = one(params.category);
  const examSlug = one(params.exam);
  const query = one(params.q);
  const sort = toUpdateSort(one(params.sort));
  const cursor = one(params.after);

  const page = await listExamUpdates({
    // Narrowed rather than trusted: `category` comes from the URL, and an
    // unknown value would reach Postgres as an invalid enum literal.
    category: isCategory(category) ? category : undefined,
    examSlug,
    query,
    sort,
    cursor,
    limit: PAGE_SIZE.list,
  });

  if (page.items.length === 0) {
    // Names what was searched rather than shrugging. "No updates match those
    // filters" tells someone nothing they did not already know.
    const applied = [
      query ? `“${query}”` : null,
      category ? (CATEGORY_FILTERS.find((f) => f.value === category)?.label ?? category) : null,
      examSlug,
      sort !== "newest" ? "Oldest" : null,
    ]
      .filter(Boolean)
      .join(" · ");

    return (
      <div className="mt-6 rounded-lg border border-dashed border-line px-6 py-12 text-center">
        <p className="font-semibold text-ink">Nothing here{applied ? ` for ${applied}` : ""}</p>
        <p className="mt-1 text-sm text-ink-2">
          Updates are collected from official sources as they are announced. Try a broader
          search, or clear the filters.
        </p>
        <Link
          href="/updates"
          className="mt-4 inline-block text-sm font-semibold text-accent hover:underline"
        >
          Clear all filters
        </Link>
      </div>
    );
  }

  return (
    <InfiniteUpdateList
      initialItems={page.items}
      initialCursor={page.nextCursor}
      filterParams={{
        category,
        exam: examSlug,
        q: query,
        sort,
      }}
      sortOptions={UPDATE_SORTS}
    />
  );
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isCategory(value: string | undefined): value is UpdateCategory {
  return value !== undefined && CATEGORY_FILTERS.some((filter) => filter.value === value);
}

function ResultsSkeleton() {
  return (
    <>
      <div className="mt-2 flex items-center justify-between border-b border-line pb-1.5">
        <div className="skeleton h-3 w-24" />
        <div className="skeleton h-8 w-36 rounded-full" />
      </div>
      <ul className="mt-4 flex flex-col gap-3" aria-busy="true" aria-label="Loading updates">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i}>
            <UpdateCardSkeleton variant="card" />
          </li>
        ))}
      </ul>
    </>
  );
}
