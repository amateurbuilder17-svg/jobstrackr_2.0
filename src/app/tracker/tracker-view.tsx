"use client";

import { useMemo, useState } from "react";

import { PlusIcon, ShieldIcon } from "@/components/icons";
import { useToday } from "@/components/jobs/today-provider";
import type { ExamAttempt } from "@/lib/db/queries/attempts";
import type { ExamUpdateSignal } from "@/lib/db/queries/exam-updates";
import type { ExamStatusReport } from "@/lib/exams/report";
import { subjectKeyFor } from "@/lib/exams/subject";
import { AttemptForm } from "./attempt-form";
import { AttemptList } from "./attempt-list";
import { categorizeAttempts, countByCategory } from "./categorize";

export function TrackerView({
  attempts,
  reports,
  signals,
  today: serverToday,
}: {
  attempts: ExamAttempt[];
  reports: Record<string, ExamStatusReport>;
  signals: Record<string, ExamUpdateSignal[]>;
  /** Today in India as the server saw it; see the comment at the call site. */
  today: string;
}) {
  const [formOpen, setFormOpen] = useState(false);

  // The provider's value wins once it exists, so a tab left open overnight
  // regroups at IST midnight along with the countdowns inside the cards.
  const clientToday = useToday();
  const today = clientToday ?? serverToday;

  // Grouped once, here, because the header's "need attention" count and the
  // section a card lands in have to be the same answer. They were computed
  // separately before, from two different rules, and disagreed.
  const items = useMemo(
    () => categorizeAttempts(attempts, reports, signals, today, subjectKeyFor),
    [attempts, reports, signals, today],
  );
  const counts = useMemo(() => countByCategory(items), [items]);

  const trackedCount = attempts.length;
  const attentionCount = counts.action;

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
        <AttemptList items={items} counts={counts} />
      </div>

      {/* Verified Commission Signal Footnote */}
      {attempts.length > 0 ? (
        <div className="mt-8 flex items-start gap-2.5 rounded-xl border border-border bg-card/60 p-3.5 text-xs leading-relaxed text-muted-foreground shadow-card">
          <ShieldIcon className="mt-0.5 size-4 shrink-0 text-brand" />
          <p>
            Status updates are automatically verified via official commission portals and web
            signals. The conducting commission&rsquo;s official portal remains the sole legal
            authority.
          </p>
        </div>
      ) : null}

      {/* Track Another Exam Modal */}
      <AttemptForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
        }}
      />
    </>
  );
}
