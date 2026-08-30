"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { JobCard, JobCardSkeleton } from "@/components/jobs/job-card";
import type { JobCard as JobCardData } from "@/lib/db/queries/jobs";
import { useSaved } from "@/components/session/session-provider";

/**
 * The saved list for a visitor with no account.
 *
 * Their shortlist exists only in this browser, so the server cannot render it —
 * the ids have to be exchanged for cards from here. This is the one genuine
 * client-fetched list in the codebase, and the reason `/api/jobs/cards` exists.
 *
 * `JobCard` is imported directly rather than passed down as a render function:
 * its whole dependency chain is client-safe, and functions cannot cross the
 * server/client boundary anyway.
 */
export function GuestSavedList() {
  const { ready, isSaved, savedIds } = useSaved();
  const [jobs, setJobs] = useState<JobCardData[] | null>(null);

  // Joined into a string: a fresh array identity on every render would refetch
  // continuously, and the identity is not what changed — the membership is.
  const key = savedIds.join(",");

  useEffect(() => {
    // The empty case is derived in render rather than assigned here. Setting
    // state synchronously in an effect body triggers a second render pass for
    // something already knowable from `key`.
    if (!ready || key === "") return;

    const controller = new AbortController();

    void (async () => {
      try {
        const response = await fetch(`/api/jobs/cards?ids=${key}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(String(response.status));
        const data = (await response.json()) as { jobs: JobCardData[] };
        setJobs(data.jobs);
      } catch {
        // Offline, most likely — or aborted, which is not a failure worth
        // rendering. Holding the skeleton is more honest than an empty state,
        // which would claim the shortlist is gone.
        if (!controller.signal.aborted) setJobs(null);
      }
    })();

    return () => {
      controller.abort();
    };
  }, [ready, key]);

  if (ready && key === "") return <EmptySaved />;

  if (!ready || jobs === null) {
    return (
      <div className="mt-6 flex flex-col gap-3">
        <JobCardSkeleton />
        <JobCardSkeleton />
      </div>
    );
  }

  // Filtered through the live store, so unsaving removes a card immediately
  // rather than leaving it until the next fetch.
  const visible = jobs.filter((job) => isSaved(job.id));
  if (visible.length === 0) return <EmptySaved />;

  return (
    <>
      <p className="mt-6 rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink-2">
        These are saved on this device.{" "}
        <Link href="/sign-in?next=/saved" className="font-medium text-accent hover:underline">
          Sign in
        </Link>{" "}
        to keep them.
      </p>
      <div className="mt-3 flex flex-col gap-3">
        {visible.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
      </div>
    </>
  );
}

export function EmptySaved() {
  return (
    <div className="mt-6 rounded-lg border border-dashed border-line px-4 py-10 text-center">
      <p className="text-sm font-medium text-ink">Nothing saved yet.</p>
      <p className="mt-1 text-sm text-ink-2">Tap the bookmark on any job to keep it here.</p>
      <Link
        href="/jobs"
        className="mt-4 inline-block text-sm font-medium text-accent hover:underline"
      >
        Browse jobs
      </Link>
    </div>
  );
}
