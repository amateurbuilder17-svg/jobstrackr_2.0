import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { FilterChips } from "@/components/filters/filter-chips";
import { SortToggle } from "@/components/filters/filter-bar";
import { UpdateCard, UpdateCardSkeleton } from "@/components/updates/update-card";
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
 *
 * ── What this replaces ────────────────────────────────────────────────────
 * The old "Trending" page had a search box, eight category tabs, two dropdown
 * filters, a Latest toggle, active filter pills and a 24-hour section. It did
 * all of it in the browser, over the newest 100 rows it had downloaded, with a
 * second whole-table search bolted on beside it and a Framer-animated bar that
 * hid itself as you scrolled.
 *
 * This does the finding in Postgres against a GIN index, keeps every choice in
 * the URL so a filtered feed is shareable, and drops two things on purpose:
 *
 *   **The refresh button.** Content arrives here by tag invalidation. A button
 *   that cannot fetch anything newer than the CDN already holds is a lie about
 *   how the system works.
 *
 *   **The location filter.** The old one matched state names and their
 *   abbreviations against an exam's name and description, and returned
 *   confident nonsense. Exam updates carry no state column. It comes back when
 *   there is something real to filter on.
 */
export default function UpdatesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-2 lg:px-6 lg:py-6">
      {/* Search lives in the top bar on this route — see `TopBar`. Suspense
          because these read useSearchParams, which would otherwise opt the
          whole route out of static rendering. */}
      <Suspense fallback={<div className="h-9" />}>
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
    const applied = [query ? `“${query}”` : null, category, examSlug]
      .filter(Boolean)
      .join(" · ");

    return (
      <div className="mt-8 rounded-lg border border-dashed border-line px-6 py-12 text-center">
        <p className="font-semibold text-ink">Nothing here{applied ? ` for ${applied}` : ""}</p>
        <p className="mt-1 text-sm text-ink-2">
          Updates are collected from official sources as they are announced. Try a broader
          search, or clear the filters.
        </p>
        <Link
          href="/updates"
          className="mt-4 inline-block text-sm font-semibold text-accent hover:underline"
        >
          Show everything
        </Link>
      </div>
    );
  }

  // Carry the current filters onto the next page, or "Load more" silently drops
  // them and pages through an entirely different result set.
  const nextParams = new URLSearchParams();
  if (category) nextParams.set("category", category);
  if (examSlug) nextParams.set("exam", examSlug);
  if (query) nextParams.set("q", query);
  if (sort === "oldest") nextParams.set("sort", "oldest");
  if (page.nextCursor) nextParams.set("after", page.nextCursor);

  return (
    <>
      <div className="mt-2 flex items-center justify-between gap-3 border-b border-line pb-1.5">
        {/* Announced politely so a screen-reader user hears the list change
            after a filter, rather than having to go looking for it. */}
        <p aria-live="polite" className="tabular text-xs text-ink-3">
          {page.nextCursor
            ? `${String(page.items.length)}+ updates`
            : `${String(page.items.length)} update${page.items.length === 1 ? "" : "s"}`}
        </p>
        <Suspense fallback={<div className="h-8" />}>
          <SortToggle options={UPDATE_SORTS} label="Sort updates by" />
        </Suspense>
      </div>

      <ul className="mt-4 flex flex-col gap-3">
        {page.items.map((update) => (
          <li key={update.id}>
            <UpdateCard update={update} />
          </li>
        ))}
      </ul>

      {page.nextCursor ? (
        <div className="mt-6 flex justify-center">
          {/* A real link, not a button: it works without JavaScript, the next
              page is shareable, and Next still navigates it client-side. */}
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
        <p className="mt-6 text-center text-xs text-ink-3">That is every matching update.</p>
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
    <>
      <div className="mt-2 flex items-center justify-between border-b border-line pb-1.5">
        <div className="skeleton h-3 w-24" />
        <div className="skeleton h-8 w-36 rounded-full" />
      </div>
      <ul className="mt-4 flex flex-col gap-3" aria-busy="true" aria-label="Loading updates">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i}>
            <UpdateCardSkeleton />
          </li>
        ))}
      </ul>
    </>
  );
}
