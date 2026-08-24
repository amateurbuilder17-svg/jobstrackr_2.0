import type { Metadata } from "next";
import { Suspense } from "react";

import { JobCard, JobCardSkeleton } from "@/components/jobs/job-card";
import { EmptySaved, GuestSavedList } from "@/components/saved/guest-saved-list";
import { getUser } from "@/lib/auth/session";
import { listSavedJobs } from "@/lib/db/queries/saved";

export const metadata: Metadata = {
  title: "Saved jobs",
  robots: { index: false, follow: false },
};

/**
 * Saved jobs, for two quite different visitors.
 *
 * Signed in, the list is server-rendered from their rows. Signed out, it is
 * rendered in the browser from localStorage, because that is genuinely where
 * their shortlist lives. The page is not behind the auth middleware for that
 * reason: sending someone to a sign-in screen to look at their own saved jobs
 * would be the app withholding their data from them.
 */
export default function SavedPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 lg:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Saved jobs</h1>
      <p className="mt-1 text-sm text-ink-2">Everything you have bookmarked, newest first.</p>

      <Suspense fallback={<SavedSkeleton />}>
        <SavedList />
      </Suspense>
    </div>
  );
}

async function SavedList() {
  const user = await getUser();

  // Guests get the client-rendered list; there is nothing on the server to
  // render for them.
  if (!user) return <GuestSavedList />;

  const saved = await listSavedJobs();

  // `job` is null when a saved job has since been unpublished — RLS hides it
  // rather than deleting the bookmark. Dropping it here is better than a card
  // with no title, and better than deleting a row the job might return to.
  const jobs = saved.map((row) => row.job).filter((job) => job !== null);

  if (jobs.length === 0) return <EmptySaved />;

  return (
    <div className="mt-6 flex flex-col gap-3">
      {jobs.map((job) => (
        <JobCard key={job.id} job={job} />
      ))}
    </div>
  );
}

function SavedSkeleton() {
  return (
    <div className="mt-6 flex flex-col gap-3">
      <JobCardSkeleton />
      <JobCardSkeleton />
      <JobCardSkeleton />
    </div>
  );
}
