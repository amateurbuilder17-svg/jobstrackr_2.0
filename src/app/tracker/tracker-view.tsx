"use client";

import { useState } from "react";

import { PlusIcon, ShieldIcon } from "@/components/icons";
import type { ExamAttempt, ExamOption } from "@/lib/db/queries/attempts";
import type { ExamStatusReport } from "@/lib/exams/report";
import { AttemptForm } from "./attempt-form";
import { AttemptList } from "./attempt-list";

export function TrackerView({
  attempts,
  exams,
  reports,
}: {
  attempts: ExamAttempt[];
  exams: ExamOption[];
  reports: Record<string, ExamStatusReport>;
}) {
  const [formOpen, setFormOpen] = useState(false);

  const trackedCount = attempts.length;
  const attentionCount = attempts.filter((a) => {
    return (
      a.status === "admit_card" ||
      a.status === "tracking" ||
      a.status === "applied"
    );
  }).length;

  return (
    <>
      {/* Header */}
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-[27px] font-extrabold leading-tight tracking-tight text-foreground">
            My Exams
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {String(trackedCount)} tracked · {String(attentionCount)} need attention
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            setFormOpen(true);
          }}
          aria-label="Track another exam"
          className="grid size-11 shrink-0 place-items-center rounded-full bg-brand text-primary-foreground shadow-pill transition-all duration-200 hover:bg-brand-deep active:scale-95"
        >
          <PlusIcon className="size-5" aria-hidden="true" />
        </button>
      </header>

      {/* Main Attempts List with Category Sections & Accordion */}
      <div className="mt-6">
        <AttemptList attempts={attempts} reports={reports} />
      </div>

      {/* Verified Commission Signal Footnote */}
      {attempts.length > 0 ? (
        <div className="mt-8 flex items-start gap-2.5 rounded-xl border border-border bg-card/60 p-3.5 text-xs leading-relaxed text-muted-foreground shadow-card">
          <ShieldIcon className="mt-0.5 size-4 shrink-0 text-brand" />
          <p>
            Status updates are automatically verified via official commission portals and web signals. The conducting commission&rsquo;s official portal remains the sole legal authority.
          </p>
        </div>
      ) : null}

      {/* Track Another Exam Modal */}
      <AttemptForm
        exams={exams}
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
        }}
      />
    </>
  );
}
