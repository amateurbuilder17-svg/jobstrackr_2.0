"use client";

import { Suspense, useCallback, useMemo } from "react";

import { SortToggle, type SortOption } from "@/components/filters/filter-bar";
import { JobCard, JobCardSkeleton } from "@/components/jobs/job-card";
import type { JobCard as JobCardData } from "@/lib/db/queries/jobs";
import { useInfiniteFeed } from "@/lib/hooks/use-infinite-feed";
import { guardedJson } from "@/lib/net/guarded-fetch";

export interface JobFilterValues {
  q?: string | undefined;
  state?: string | undefined;
  level?: string | undefined;
  stream?: string | undefined;
  sector?: string | undefined;
  sort?: string | undefined;
}

export function InfiniteJobList({
  initialItems,
  initialCursor,
  filterParams,
  sortOptions,
}: {
  initialItems: JobCardData[];
  initialCursor: string | null;
  filterParams: JobFilterValues;
  sortOptions?: readonly [SortOption, SortOption];
}) {
  const filterKey = useMemo(() => {
    const params = new URLSearchParams();
    if (filterParams.q) params.set("q", filterParams.q);
    if (filterParams.state) params.set("state", filterParams.state);
    if (filterParams.level) params.set("level", filterParams.level);
    if (filterParams.stream) params.set("stream", filterParams.stream);
    if (filterParams.sector) params.set("sector", filterParams.sector);
    if (filterParams.sort && filterParams.sort !== "closing")
      params.set("sort", filterParams.sort);
    return params.toString() || "all";
  }, [filterParams]);

  const fetchNextPage = useCallback(
    async (cursor: string) => {
      const params = new URLSearchParams();
      if (filterParams.q) params.set("q", filterParams.q);
      if (filterParams.state) params.set("state", filterParams.state);
      if (filterParams.level) params.set("level", filterParams.level);
      if (filterParams.stream) params.set("stream", filterParams.stream);
      if (filterParams.sector) params.set("sector", filterParams.sector);
      if (filterParams.sort && filterParams.sort !== "closing")
        params.set("sort", filterParams.sort);
      params.set("after", cursor);

      // Guarded rather than bare: a page of the feed is requested by an
      // observer that re-fires whenever the sentinel is in view, so an
      // endpoint that is down must be allowed to stop being asked.
      return await guardedJson<{ items: JobCardData[]; nextCursor: string | null }>(
        `/api/jobs?${params.toString()}`,
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
  } = useInfiniteFeed<JobCardData>({
    storagePrefix: "jobs",
    filterKey,
    initialItems,
    initialCursor,
    fetchNextPage,
  });

  const hasFilters = Boolean(
    filterParams.q ??
    filterParams.state ??
    filterParams.level ??
    filterParams.stream ??
    filterParams.sector,
  );

  const countLabel = useMemo(() => {
    if (nextCursor) {
      if (!hasFilters) {
        return "10,000+ open jobs";
      }
      return `${String(Math.max(items.length, 100))}+ open jobs`;
    }
    return `${String(items.length)} open ${items.length === 1 ? "job" : "jobs"}`;
  }, [nextCursor, hasFilters, items.length]);

  return (
    <>
      <div className="mt-2 flex items-center justify-between gap-3 border-b border-line pb-1.5">
        <p aria-live="polite" className="tabular text-xs text-ink-3">
          {countLabel}
        </p>
        {sortOptions ? (
          <Suspense fallback={<div className="h-8" />}>
            <SortToggle options={sortOptions} label="Sort jobs by" />
          </Suspense>
        ) : null}
      </div>

      <ul className="mt-4 flex flex-col gap-3" onClickCapture={recordClickPosition}>
        {items.map((job) => (
          <li key={job.id}>
            <JobCard job={job} variant="card" />
          </li>
        ))}
      </ul>

      {/* Sentinel for IntersectionObserver */}
      {nextCursor ? <div ref={sentinelRef} className="h-4 w-full" aria-hidden="true" /> : null}

      {/* Loading indicator skeletons */}
      {isLoading ? (
        <div className="mt-4 flex flex-col gap-3">
          <JobCardSkeleton variant="card" />
          <JobCardSkeleton variant="card" />
        </div>
      ) : null}

      {/* Error state with retry */}
      {isError ? (
        <div className="mt-4 flex flex-col items-center justify-center gap-2 py-4">
          <p className="text-xs text-ink-3">
            {retryIn > 0
              ? "The server is not responding. Waiting before trying again."
              : "Could not load more jobs."}
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
        <p className="mt-4 text-center text-xs text-ink-3">That is every matching job.</p>
      ) : null}
    </>
  );
}
