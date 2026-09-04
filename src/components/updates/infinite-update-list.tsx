"use client";

import { Suspense, useCallback, useMemo } from "react";

import { SortToggle, type SortOption } from "@/components/filters/filter-bar";
import { UpdateCard, UpdateCardSkeleton } from "@/components/updates/update-card";
import type { ExamUpdateCard as UpdateData } from "@/lib/db/queries/exam-updates";
import { useInfiniteFeed } from "@/lib/hooks/use-infinite-feed";
import { guardedJson } from "@/lib/net/guarded-fetch";

export interface UpdateFilterValues {
  category?: string | undefined;
  exam?: string | undefined;
  q?: string | undefined;
  sort?: string | undefined;
}

export function InfiniteUpdateList({
  initialItems,
  initialCursor,
  filterParams,
  sortOptions,
}: {
  initialItems: UpdateData[];
  initialCursor: string | null;
  filterParams: UpdateFilterValues;
  sortOptions?: readonly [SortOption, SortOption];
}) {
  const filterKey = useMemo(() => {
    const params = new URLSearchParams();
    if (filterParams.category) params.set("category", filterParams.category);
    if (filterParams.exam) params.set("exam", filterParams.exam);
    if (filterParams.q) params.set("q", filterParams.q);
    if (filterParams.sort === "oldest") params.set("sort", "oldest");
    return params.toString() || "all";
  }, [filterParams]);

  const fetchNextPage = useCallback(
    async (cursor: string) => {
      const params = new URLSearchParams();
      if (filterParams.category) params.set("category", filterParams.category);
      if (filterParams.exam) params.set("exam", filterParams.exam);
      if (filterParams.q) params.set("q", filterParams.q);
      if (filterParams.sort === "oldest") params.set("sort", "oldest");
      params.set("after", cursor);

      // Guarded rather than bare: a page of the feed is requested by an
      // observer that re-fires whenever the sentinel is in view, so an
      // endpoint that is down must be allowed to stop being asked.
      return await guardedJson<{ items: UpdateData[]; nextCursor: string | null }>(
        `/api/updates?${params.toString()}`,
      );
    },
    [filterParams],
  );

  const {
    items,
    nextCursor,
    isLoading,
    isError,
    retryIn,
    loadMore,
    sentinelRef,
    recordClickPosition,
  } = useInfiniteFeed<UpdateData>({
    storagePrefix: "updates",
    filterKey,
    initialItems,
    initialCursor,
    fetchNextPage,
  });

  const hasFilters = Boolean(filterParams.category ?? filterParams.exam ?? filterParams.q);

  const countLabel = useMemo(() => {
    if (nextCursor) {
      if (!hasFilters) {
        return "5,000+ updates";
      }
      return `${String(Math.max(items.length, 100))}+ updates`;
    }
    return `${String(items.length)} update${items.length === 1 ? "" : "s"}`;
  }, [nextCursor, hasFilters, items.length]);

  return (
    <>
      <div className="mt-2 flex items-center justify-between gap-3 border-b border-line pb-1.5">
        <p aria-live="polite" className="tabular text-xs text-ink-3">
          {countLabel}
        </p>
        {sortOptions ? (
          <Suspense fallback={<div className="h-8" />}>
            <SortToggle options={sortOptions} label="Sort updates by" />
          </Suspense>
        ) : null}
      </div>

      <ul className="mt-4 flex flex-col gap-3" onClickCapture={recordClickPosition}>
        {items.map((update) => (
          <li key={update.id}>
            <UpdateCard update={update} variant="card" />
          </li>
        ))}
      </ul>

      {/* Sentinel for IntersectionObserver */}
      {nextCursor ? <div ref={sentinelRef} className="h-4 w-full" aria-hidden="true" /> : null}

      {/* Loading skeletons */}
      {isLoading ? (
        <div className="mt-4 flex flex-col gap-3">
          <UpdateCardSkeleton variant="card" />
          <UpdateCardSkeleton variant="card" />
        </div>
      ) : null}

      {/* Error state with retry */}
      {isError ? (
        <div className="mt-4 flex flex-col items-center justify-center gap-2 py-4">
          <p className="text-xs text-ink-3">
            {retryIn > 0
              ? "The server is not responding. Waiting before trying again."
              : "Could not load more updates."}
          </p>
          <button
            type="button"
            disabled={retryIn > 0}
            onClick={() => {
              void loadMore();
            }}
            className={
              "inline-flex h-9 items-center rounded-md border border-line bg-surface px-4 " +
              "text-xs font-medium text-ink transition-colors hover:border-line-strong hover:bg-surface-2 " +
              "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-line disabled:hover:bg-surface"
            }
          >
            {retryIn > 0 ? `Retry in ${String(retryIn)}s` : "Retry"}
          </button>
        </div>
      ) : null}

      {/* End of feed message */}
      {!nextCursor && items.length > 0 ? (
        <p className="mt-4 text-center text-xs text-ink-3">That is every matching update.</p>
      ) : null}
    </>
  );
}
