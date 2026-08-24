import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { listExamAttempts, listExams } from "@/lib/db/queries/attempts";
import { AttemptForm } from "./attempt-form";
import { AttemptList } from "./attempt-list";

export const metadata: Metadata = {
  title: "My Exams",
  robots: { index: false, follow: false },
};

/**
 * The tracker.
 *
 * Personal data throughout, so the shell is static and everything below it
 * streams — the same split as /profile, and for the same Cache Components
 * reason: reading cookies outside a Suspense boundary is a build error here.
 */
export default function TrackerPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 lg:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">My Exams</h1>
      <p className="mt-1 text-sm text-ink-2">
        Everything you are sitting, and where each one has got to.
      </p>

      <Suspense fallback={<TrackerSkeleton />}>
        <Tracker />
      </Suspense>
    </div>
  );
}

async function Tracker() {
  await requireUser("/tracker");

  // The attempts are per-user and uncached; the exam list is public reference
  // data and cached. Fetched together so the page waits once, not twice.
  const [attempts, exams] = await Promise.all([listExamAttempts(), listExams()]);

  return (
    <>
      <AttemptList attempts={attempts} />
      <AttemptForm exams={exams} />
    </>
  );
}

function TrackerSkeleton() {
  return (
    <div className="mt-6 flex flex-col gap-3">
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-20 w-full rounded-lg" />
      ))}
    </div>
  );
}
