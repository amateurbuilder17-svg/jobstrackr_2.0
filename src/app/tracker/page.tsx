import type { Metadata } from "next";
import { Suspense } from "react";

import { requireUser } from "@/lib/auth/session";
import { listExamAttempts } from "@/lib/db/queries/attempts";
import { listStatusReports } from "@/lib/db/queries/exam-status";
import { listUpdateSignals, type ExamUpdateSignal } from "@/lib/db/queries/exam-updates";
import type { ExamStatusReport } from "@/lib/exams/report";
import { subjectKeyFor } from "@/lib/exams/subject";
import { todayInIndia } from "@/lib/format/deadline";
import { TrackerView } from "./tracker-view";

export const metadata: Metadata = {
  title: "My Exams · Jobstrackr",
  description:
    "Track Indian government jobs and competitive exams in one place. See deadlines, admit cards, exam progress and what to do next.",
  robots: { index: false, follow: false },
};

/**
 * The My Exams tracker page.
 *
 * Built with progressive streaming SSR. Cookies are read within the
 * Suspense boundary to maintain static shell performance.
 */
export default function TrackerPage() {
  return (
    <div className="mx-auto w-full max-w-md px-4 pt-8 pb-32 sm:max-w-lg lg:max-w-xl">
      <Suspense fallback={<TrackerSkeleton />}>
        <Tracker />
      </Suspense>
    </div>
  );
}

async function Tracker() {
  await requireUser("/tracker");

  // `listExams()` used to ride along here to fill the add-form's picker. The
  // picker is gone (the table holds no rows, and the form suggests live
  // notifications instead), so this page makes one fewer read per view.
  const attempts = await listExamAttempts();

  const keys = attempts.map(subjectKeyFor).filter((key): key is string => key !== null);

  // Both reads are keyed on the same subjects and neither depends on the
  // other, so they go together rather than one after the next.
  const [reports, signals] = await Promise.all([
    listStatusReports(keys),
    listUpdateSignals(
      attempts.map((a) => a.exam_id).filter((id): id is string => id !== null),
      attempts.map((a) => a.job_id).filter((id): id is string => id !== null),
    ),
  ]);

  const byKey: Record<string, ExamStatusReport> = Object.fromEntries(reports);
  const signalsByKey: Record<string, ExamUpdateSignal[]> = Object.fromEntries(signals);

  return (
    <TrackerView
      attempts={attempts}
      reports={byKey}
      signals={signalsByKey}
      // Computed here rather than read from the client clock, so the grouping
      // the server renders is the grouping that hydrates. `useToday` still
      // drives the live countdowns, and takes over at IST midnight.
      today={todayInIndia()}
    />
  );
}

function TrackerSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200" aria-hidden="true">
      {/* Header skeleton */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="space-y-2">
          <div className="skeleton h-7 w-36" />
          <div className="skeleton h-4 w-48" />
        </div>
        <div className="skeleton size-11 rounded-full shrink-0" />
      </div>

      {/* Tabs skeleton */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1 no-scrollbar">
        <div className="skeleton h-9 w-16 rounded-full" />
        <div className="skeleton h-9 w-20 rounded-full" />
        <div className="skeleton h-9 w-24 rounded-full" />
        <div className="skeleton h-9 w-24 rounded-full" />
      </div>

      {/* Cards skeleton */}
      <div className="space-y-3 pt-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-border bg-card p-4 shadow-card space-y-3"
          >
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
              <div className="skeleton size-9 rounded-xl" />
              <div className="space-y-1.5 flex-1">
                <div className="skeleton h-4.5 w-3/4" />
                <div className="skeleton h-3.5 w-1/2" />
                <div className="skeleton h-5 w-20 rounded-full" />
              </div>
              <div className="skeleton size-5 rounded-xs mt-1" />
            </div>
            <div className="skeleton h-10 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}
