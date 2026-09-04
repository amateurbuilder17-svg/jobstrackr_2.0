"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";

import { OrganizationBadge } from "@/components/home/primitives";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  TrackerIcon,
} from "@/components/icons";
import { useToday } from "@/components/jobs/today-provider";
import { Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { EMPTY_FORM_STATE } from "@/lib/auth/form-state";
import { cn } from "@/lib/cn";
import type { ExamAttempt } from "@/lib/db/queries/attempts";
import type { ExamStatusReport } from "@/lib/exams/report";
import { deleteAttemptAction, setAttemptStatusAction } from "@/lib/tracker/actions";
import { ATTEMPT_STATUSES, STATUS_LABELS, type AttemptStatus } from "@/lib/tracker/enums";
import type { CategorizedAttempt, ExamCategory } from "./categorize";
import { computeNextEvent, computeStages, ExamProgress } from "./exam-progress";
import { FilterTabs, type FilterKey } from "./filter-tabs";
import { StatusBadge } from "./status-badge";
import { StatusPanel } from "./status-panel";

const STATUS_OPTIONS = ATTEMPT_STATUSES.map((s) => ({
  value: s,
  label: STATUS_LABELS[s],
}));

const SECTIONS: { key: ExamCategory; title: string; quiet?: boolean }[] = [
  { key: "action", title: "Action Required" },
  { key: "upcoming", title: "Upcoming" },
  { key: "completed", title: "Completed", quiet: true },
];

export function AttemptList({
  items,
  counts,
}: {
  /** Already grouped and ordered — see `categorize.ts`. */
  items: CategorizedAttempt[];
  counts: Record<ExamCategory, number>;
}) {
  const [filter, setFilter] = useState<FilterKey>("all");
  /**
   * Which cards the user has *closed*, not which ones are open.
   *
   * Every exam is expanded by default — this page exists to show admit-card,
   * exam and result dates, and a card that starts collapsed hides exactly the
   * thing the visit was for. Tracking the closures rather than the openings is
   * what makes that hold: a set of open ids would have to be seeded from
   * `items`, and any exam added or re-categorised after that seeding would
   * arrive collapsed. An id absent from this set is open, so new rows are open
   * for free.
   *
   * It is also no longer an accordion. Opening one card used to close the
   * others, which is the wrong trade here — these are independent exams a
   * candidate compares side by side, not sections of one document.
   */
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const tabCounts = useMemo<Partial<Record<FilterKey, number>>>(
    () => ({ all: items.length, ...counts }),
    [items.length, counts],
  );

  const visible = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((item) => item.category === filter);
  }, [items, filter]);

  if (items.length === 0) {
    return (
      <div className="mt-8 rounded-2xl border border-border bg-card p-8 text-center shadow-card sm:p-12 animate-in fade-in duration-200">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-border bg-brand-soft text-brand-deep shadow-2xs">
          <TrackerIcon className="size-6 text-brand" />
        </div>
        <h3 className="mt-4 text-base font-bold text-foreground">No exams tracked yet</h3>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
          Tap the + button above to add your target exams and monitor admit cards, exam dates,
          and results in one place.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filter Tabs */}
      <FilterTabs value={filter} onChange={setFilter} counts={tabCounts} />

      {/* Categorized Sections */}
      <div className="space-y-7">
        {SECTIONS.map((section) => {
          const rows = visible.filter((item) => item.category === section.key);
          if (rows.length === 0) return null;

          return (
            <section key={section.key} aria-labelledby={`section-${section.key}`}>
              <h2 id={`section-${section.key}`} className="section-label mb-3 px-0.5">
                {section.title}
              </h2>
              <div className="space-y-3">
                {rows.map(({ attempt, report }) => (
                  <ExamCardItem
                    key={attempt.id}
                    attempt={attempt}
                    report={report}
                    quiet={section.quiet}
                    expanded={!collapsedIds.has(attempt.id)}
                    onToggle={() => {
                      setCollapsedIds((cur) => {
                        const next = new Set(cur);
                        if (!next.delete(attempt.id)) next.add(attempt.id);
                        return next;
                      });
                    }}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ExamCardItem({
  attempt,
  report,
  expanded,
  onToggle,
  quiet,
}: {
  attempt: ExamAttempt;
  report: ExamStatusReport | null;
  expanded: boolean;
  onToggle: () => void;
  quiet?: boolean | undefined;
}) {
  const [, statusAction] = useActionState(setAttemptStatusAction, EMPTY_FORM_STATE);
  const [, removeAction] = useActionState(deleteAttemptAction, EMPTY_FORM_STATE);

  const status = attempt.status as AttemptStatus;
  const name =
    attempt.exam?.name ?? attempt.custom_name ?? attempt.job?.title ?? "Untitled exam";
  const org =
    attempt.exam?.short_name ??
    attempt.exam?.name.slice(0, 5) ??
    attempt.job?.title.slice(0, 5) ??
    "EXAM";
  const orgFull = attempt.exam?.name ?? attempt.exam?.short_name ?? attempt.job?.title ?? "";
  // The conducting body's emblem, by either route an attempt can arrive: an
  // exam picked from the list, or Track pressed on a job page.
  const logo = attempt.exam?.organization?.logo_path ?? attempt.job?.organization?.logo_path;

  const today = useToday();
  const stages = useMemo(
    () => computeStages(status, attempt, report),
    [status, attempt, report],
  );

  // Compute Next Event
  const nextEvent = useMemo(
    () => computeNextEvent(status, attempt, report, today),
    [status, attempt, report, today],
  );

  // What to do next recommendations
  const actionTips = useMemo(() => {
    if (status === "tracking") {
      return [
        "Check eligibility criteria and syllabus requirements.",
        "Keep application ID and scanned documents ready.",
      ];
    }
    if (status === "applied") {
      return [
        "Monitor the official portal for admit card release.",
        "Practice previous year question papers and mock tests.",
      ];
    }
    if (status === "admit_card") {
      return [
        "Download and print 2 copies of your Admit Card in colour.",
        "Verify your exam centre address and reporting shift timing.",
        "Keep an original Govt Photo ID proof and 2 passport photos ready.",
      ];
    }
    if (status === "appeared") {
      return [
        "Check unofficial and official answer keys when published.",
        "Calculate estimated score and prepare for next stage / tier.",
      ];
    }
    if (status === "passed") {
      return [
        "Download official scorecard and prepare for document verification / appointment.",
      ];
    }
    return [];
  }, [status]);

  const panelId = `exam-${attempt.id}-panel`;

  return (
    <article
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-card shadow-card transition-all duration-200",
        !quiet && "hover:shadow-card-hover",
        quiet && "bg-card/70 shadow-none",
        expanded && "shadow-card-hover ring-1 ring-brand/20",
      )}
    >
      {/* Clickable Header */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full min-h-11 items-start gap-3 p-4 text-left transition-colors hover:bg-muted/40 active:bg-muted/60"
      >
        <OrganizationBadge org={org} logoPath={logo} size="sm" />

        <div className="min-w-0 flex-1">
          <h3
            className={cn(
              "line-clamp-2 text-base font-bold tracking-tight text-foreground",
              quiet && "text-[15px] font-semibold text-muted-foreground",
            )}
          >
            {name}
          </h3>
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{orgFull}</p>
          <StatusBadge status={status} className="mt-2.5" />
        </div>

        <ChevronDownIcon
          className={cn(
            "mt-1 size-5 shrink-0 text-muted-foreground transition-transform duration-200",
            expanded && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      {/* Visual Exam Progress Bar */}
      <div className="px-4 pb-4">
        <ExamProgress stages={stages} />
      </div>

      {/* Interactive Next Milestone Event Box */}
      {nextEvent ? (
        <div className="mx-4 mb-4">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={panelId}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-border/70 bg-secondary/40 p-3 text-left transition-all duration-200 hover:bg-secondary/70 hover:border-brand/30 active:scale-[0.99]"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="section-label text-brand-deep text-[11px] font-bold tracking-wider">
                  NEXT MILESTONE
                </span>
                {nextEvent.tone === "warn" ? (
                  <span className="size-2 rounded-full bg-warning animate-pulse" />
                ) : null}
              </div>
              <p className="mt-0.5 truncate text-sm font-bold text-foreground">
                {nextEvent.title}
              </p>
              <p className="text-xs font-semibold tabular-nums text-brand-deep">
                {nextEvent.date}
              </p>
              {nextEvent.subtitle ? (
                <p className="mt-0.5 text-[11.5px] text-muted-foreground truncate">
                  {nextEvent.subtitle}
                </p>
              ) : null}
            </div>

            <div className="flex items-center gap-1.5 shrink-0 text-xs font-medium text-brand">
              <span className="hidden sm:inline">Details</span>
              <ChevronRightIcon
                className={cn(
                  "size-4 transition-transform duration-200 text-muted-foreground",
                  expanded && "rotate-90 text-brand",
                )}
                aria-hidden="true"
              />
            </div>
          </button>
        </div>
      ) : null}

      {/* Collapsible Expansion Panel */}
      <div
        id={panelId}
        aria-hidden={!expanded}
        className={cn(
          "grid transition-[grid-template-rows] duration-[250ms] ease-out",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="px-4 pb-4 space-y-4 border-t border-border/70 pt-4">
            {/* Candidate Details (Roll Number / Score) */}
            {attempt.roll_number || attempt.score !== null ? (
              <section
                className="border-t border-border/70 pt-3.5"
                aria-label="Candidate Credentials"
              >
                <h4 className="section-label mb-2.5">Your Details</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {attempt.roll_number ? (
                    <div className="rounded-xl border border-border/70 bg-muted/30 p-2.5">
                      <p className="text-muted-foreground">Roll / Reg No.</p>
                      <p className="mt-0.5 font-bold tabular-nums text-foreground">
                        {attempt.roll_number}
                      </p>
                    </div>
                  ) : null}
                  {attempt.score !== null ? (
                    <div className="rounded-xl border border-border/70 bg-muted/30 p-2.5">
                      <p className="text-muted-foreground">Score / Marks</p>
                      <p className="mt-0.5 font-bold tabular-nums text-foreground">
                        {String(attempt.score)}
                      </p>
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {/* User Personal Notes */}
            {attempt.notes ? (
              <section className="border-t border-border/70 pt-3.5" aria-label="Your Notes">
                <h4 className="section-label mb-1.5">Your Notes</h4>
                <p className="text-xs italic leading-relaxed text-muted-foreground">
                  &ldquo;{attempt.notes}&rdquo;
                </p>
              </section>
            ) : null}

            {/* Official AI Status Probe / Live Intelligence */}
            <section className="border-t border-border/70 pt-3.5">
              <StatusPanel attemptId={attempt.id} name={name} initial={report} />
            </section>

            {/* What to do next Recommendation Box */}
            {actionTips.length > 0 ? (
              <section className="rounded-xl bg-brand-soft p-3.5" aria-label="What to do next">
                <h4 className="section-label text-brand-deep mb-2">What to do next</h4>
                <ul className="space-y-1.5">
                  {actionTips.map((tip) => (
                    <li key={tip} className="flex items-start gap-2 text-xs text-brand-deep">
                      <CheckIcon
                        className="mt-0.5 size-3.5 shrink-0 stroke-[2.5]"
                        aria-hidden="true"
                      />
                      <span className="min-w-0">{tip}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* Original notification link */}
            {attempt.job ? (
              <div className="pt-1">
                <Link
                  href={`/jobs/${attempt.job.slug}`}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:underline"
                >
                  <span>View official notification</span>
                  <ArrowRightIcon className="size-3.5" aria-hidden="true" />
                </Link>
              </div>
            ) : null}

            {/* Status Update & Delete Controls */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-3">
              <form action={statusAction} className="flex items-center gap-2">
                <input type="hidden" name="id" value={attempt.id} />
                <label htmlFor={`status-${attempt.id}`} className="sr-only">
                  Status for {name}
                </label>
                <Select
                  id={`status-${attempt.id}`}
                  name="status"
                  options={STATUS_OPTIONS}
                  defaultValue={status}
                  className="h-8.5 w-36 rounded-lg text-xs"
                />
                <SubmitButton
                  size="sm"
                  pendingLabel="Saving…"
                  className="h-8.5 rounded-lg px-3 text-xs"
                >
                  Update
                </SubmitButton>
              </form>

              <form action={removeAction} className="ml-auto">
                <input type="hidden" name="id" value={attempt.id} />
                <SubmitButton
                  variant="ghost"
                  size="sm"
                  pendingLabel="Removing…"
                  className="h-8.5 rounded-lg text-xs text-muted-foreground hover:bg-danger-soft hover:text-danger"
                >
                  Remove
                </SubmitButton>
              </form>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
