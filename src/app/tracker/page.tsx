import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { listExamAttempts, listExams } from "@/lib/db/queries/attempts";
import { listStatusReports } from "@/lib/db/queries/exam-status";
import type { ExamStatusReport } from "@/lib/exams/report";
import { subjectKeyFor } from "@/lib/exams/subject";
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

  // A third round trip, and it has to be third: the subject keys are computed
  // from the attempts. It is one query for the whole page — reports are shared
  // between everyone tracking the same exam, so this reads the cache rather
  // than anything per-user, and it never calls a model. Rendering this page
  // costs nothing at Google.
  const keys = attempts.map(subjectKeyFor).filter((key): key is string => key !== null);
  const reports = await listStatusReports(keys);

  // A plain object rather than the Map: it crosses into a Client Component,
  // and an object is the shape that costs nothing to reason about there.
  const byKey: Record<string, ExamStatusReport> = Object.fromEntries(reports);

  return (
    <>
      <AttemptList attempts={attempts} reports={byKey} />

      {attempts.length > 0 ? (
        // Once, at the foot of the list, rather than on every card. The old app
        // repeated this warning per exam and it stopped being read.
        <p className="mt-4 rounded-md border border-line bg-surface-2/50 px-3 py-2 text-2xs leading-4 text-ink-3">
          Status answers are researched automatically and can be wrong or out of date. The
          conducting body&rsquo;s own website is the only thing that decides an admit card, a
          date or a result.
        </p>
      ) : null}

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
