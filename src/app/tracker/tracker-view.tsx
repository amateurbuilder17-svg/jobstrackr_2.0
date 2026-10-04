"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";

import { PlusIcon, ShieldIcon } from "@/components/icons";
import { useToday } from "@/components/jobs/today-provider";
import type { ExamAttempt } from "@/lib/db/queries/attempts";
import type { ExamUpdateSignal } from "@/lib/db/queries/exam-updates";
import type { ExamStatusReport } from "@/lib/exams/report";
import { subjectKeyFor } from "@/lib/exams/subject";
// Type-only, so it is erased at compile time and the form stays out of the
// first-load graph.
import type * as AttemptFormModule from "./attempt-form";
import { AttemptList } from "./attempt-list";
import { categorizeAttempts, countByCategory } from "./categorize";

/**
 * The add-exam form, kept out of first-load JavaScript.
 *
 * `AttemptForm` returns `null` until it is opened, and most visits to My Exams
 * never open it, so its typeahead was downloaded and parsed on every visit to
 * render nothing. /tracker is the heaviest route in `budget.json`; this is the
 * relief its note asks for. Same trade, written the same longhand way, as the
 * filter sheet in `filter-bar.tsx`: one shared promise so the warm-up and
 * `dynamic()` make a single request, warmed on intent, and the form mounted
 * only once somebody asks for it.
 */
let formModule: Promise<typeof AttemptFormModule> | undefined;
const loadForm = () => (formModule ??= import("./attempt-form"));

/** The same load, as a handler, so no promise floats unhandled in the JSX. */
const warmForm = () => {
  void loadForm();
};

const AttemptForm = dynamic(() => loadForm().then((m) => m.AttemptForm), {
  // Nothing to server-render: the form is closed on load, and it is only ever
  // mounted in response to a press.
  ssr: false,
  loading: () => <AttemptFormFallback />,
});

/**
 * Shown only if the press lands before the chunk does — a dialog-shaped
 * placeholder rather than `null`, so on a slow connection the button does not
 * look broken. Kept to a handful of elements: unlike the form, this ships in
 * first-load JS.
 */
function AttemptFormFallback() {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-background/80 p-4 pt-[12vh] backdrop-blur-sm">
      <div className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6">
        <div className="h-5 w-32 animate-pulse rounded bg-muted" />
        <div className="h-11 animate-pulse rounded-xl bg-muted" />
        <span className="sr-only" role="status">
          Loading
        </span>
      </div>
    </div>
  );
}

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
  /**
   * Whether the form has ever been opened. One-way: once mounted it stays
   * mounted, so closing and reopening behave as before the split. What it
   * prevents is the first render mounting the form, which would fetch the
   * chunk on page load and undo the split.
   */
  const [formMounted, setFormMounted] = useState(false);

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
            setFormMounted(true);
            setFormOpen(true);
          }}
          onPointerEnter={warmForm}
          onPointerDown={warmForm}
          onFocus={warmForm}
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
      {formMounted ? (
        <AttemptForm
          open={formOpen}
          onClose={() => {
            setFormOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
