import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { FilterChips } from "@/components/jobs/filter-chips";
import { UpdateCard, UpdateCardSkeleton } from "@/components/updates/update-card";
import { listExamUpdates } from "@/lib/db/queries/exam-updates";
import { PAGE_SIZE } from "@/lib/db/cursor";
import { CATEGORY_FILTERS, type UpdateCategory } from "@/lib/updates/categories";

export const metadata: Metadata = {
  title: "Exam updates",
  description:
    "Admit cards, results, answer keys and exam dates for Indian government exams, newest first.",
  alternates: { canonical: "/updates" },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * The page shell never awaits `searchParams`, so it prerenders static and comes
 * from the CDN; only `<Results>` reads them, inside Suspense. Same structure as
 * /jobs, and for the same reason — the filters and heading paint immediately
 * while the query runs.
 */
export default function UpdatesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 lg:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Exam updates</h1>
      <p className="mt-1 text-sm text-ink-2">
        Admit cards, results and answer keys as they are announced.
      </p>

      <div className="mt-6">
        <Suspense fallback={<div className="h-7" />}>
          <FilterChips param="category" label="Filter by type" options={CATEGORY_FILTERS} />
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

  const category = one(params.category);
  const cursor = one(params.after);

  const page = await listExamUpdates({
    // Narrowed rather than trusted: `category` comes from the URL, and an
    // unknown value would reach Postgres as an invalid enum literal.
    category: isCategory(category) ? category : undefined,
    cursor,
    limit: PAGE_SIZE.list,
  });

  if (page.items.length === 0) {
    return (
      <div className="mt-8 rounded-lg border border-dashed border-line px-6 py-12 text-center">
        <p className="font-medium text-ink">No updates of that type yet</p>
        <Link
          href="/updates"
          className="mt-4 inline-block text-sm font-medium text-accent hover:underline"
        >
          Show everything
        </Link>
      </div>
    );
  }

  const nextParams = new URLSearchParams();
  if (category) nextParams.set("category", category);
  if (page.nextCursor) nextParams.set("after", page.nextCursor);

  return (
    <>
      <ul className="mt-6 flex flex-col gap-3">
        {page.items.map((update) => (
          <li key={update.id}>
            <UpdateCard update={update} />
          </li>
        ))}
      </ul>

      {page.nextCursor ? (
        <div className="mt-6 flex justify-center">
          <Link
            href={`/updates?${nextParams.toString()}`}
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
        <p className="mt-6 text-center text-xs text-ink-3">That is every update.</p>
      )}
    </>
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
    <ul className="mt-6 flex flex-col gap-3" aria-busy="true" aria-label="Loading updates">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i}>
          <UpdateCardSkeleton />
        </li>
      ))}
    </ul>
  );
}
