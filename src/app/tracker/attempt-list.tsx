"use client";

import Link from "next/link";
import { useActionState, useMemo, useState } from "react";

import { OrganizationBadge } from "@/components/home/primitives";
import {
  ArrowRightIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleIcon,
  TrackerIcon,
} from "@/components/icons";
import { useToday } from "@/components/jobs/today-provider";
import { Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { EMPTY_FORM_STATE } from "@/lib/auth/form-state";
import { cn } from "@/lib/cn";
import type { ExamAttempt } from "@/lib/db/queries/attempts";
import type { ExamStatusReport } from "@/lib/exams/report";
import { subjectKeyFor } from "@/lib/exams/subject";
import { daysUntilFrom, formatDate } from "@/lib/format/deadline";
import { deleteAttemptAction, setAttemptStatusAction } from "@/lib/tracker/actions";
import {
  ATTEMPT_STATUSES,
  STATUS_LABELS,
  type AttemptStatus,
} from "@/lib/tracker/enums";
import { computeStages, ExamProgress, type Stage } from "./exam-progress";
import { FilterTabs, type FilterKey } from "./filter-tabs";
import { StatusBadge } from "./status-badge";
import { StatusPanel } from "./status-panel";

const STATUS_OPTIONS = ATTEMPT_STATUSES.map((s) => ({
  value: s,
  label: STATUS_LABELS[s],
}));

/** Settled exams are completed history */
const SETTLED: ReadonlySet<AttemptStatus> = new Set<AttemptStatus>([
  "passed",
  "failed",
  "withdrawn",
]);

type ExamCategory = "action" | "upcoming" | "completed";

function categorizeAttempt(attempt: ExamAttempt): ExamCategory {
  const status = attempt.status as AttemptStatus;
  if (SETTLED.has(status)) return "completed";
  if (status === "admit_card" || status === "tracking" || status === "applied") {
    return "action";
  }
  return "upcoming";
}

const SECTIONS: { key: ExamCategory; title: string; quiet?: boolean }[] = [
  { key: "action", title: "Action Required" },
  { key: "upcoming", title: "Upcoming" },
  { key: "completed", title: "Completed", quiet: true },
];

export function AttemptList({
  attempts,
  reports,
}: {
  attempts: ExamAttempt[];
  reports: Record<string, ExamStatusReport>;
}) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [expandedId, setExpandedId] = useState<string | null>(
    attempts[0]?.id ?? null,
  );

  const categorized = useMemo(() => {
    return attempts.map((a) => ({
      attempt: a,
      category: categorizeAttempt(a),
    }));
  }, [attempts]);

  const counts = useMemo(() => {
    const res: Partial<Record<FilterKey, number>> = {
      all: attempts.length,
      action: categorized.filter((c) => c.category === "action").length,
      upcoming: categorized.filter((c) => c.category === "upcoming").length,
      completed: categorized.filter((c) => c.category === "completed").length,
    };
    return res;
  }, [attempts.length, categorized]);

  const visible = useMemo(() => {
    if (filter === "all") return categorized;
    return categorized.filter((c) => c.category === filter);
  }, [categorized, filter]);

  if (attempts.length === 0) {
    return (
      <div className="mt-8 rounded-2xl border border-border bg-card p-8 text-center shadow-card sm:p-12 animate-in fade-in duration-200">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-border bg-brand-soft text-brand-deep shadow-2xs">
          <TrackerIcon className="size-6 text-brand" />
        </div>
        <h3 className="mt-4 text-base font-bold text-foreground">No exams tracked yet</h3>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
          Tap the + button above to add your target exams and monitor admit cards, exam dates, and results in one place.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filter Tabs */}
      <FilterTabs value={filter} onChange={setFilter} counts={counts} />

      {/* Categorized Sections */}
      <div className="space-y-7">
        {SECTIONS.map((section) => {
          const items = visible.filter((e) => e.category === section.key);
          if (items.length === 0) return null;

          return (
            <section key={section.key} aria-labelledby={`section-${section.key}`}>
              <h2 id={`section-${section.key}`} className="section-label mb-3 px-0.5">
                {section.title}
              </h2>
              <div className="space-y-3">
                {items.map(({ attempt }) => {
                  const key = subjectKeyFor(attempt);
                  const report = (key === null ? undefined : reports[key]) ?? null;

                  return (
                    <ExamCardItem
                      key={attempt.id}
                      attempt={attempt}
                      report={report}
                      quiet={section.quiet}
                      expanded={expandedId === attempt.id}
                      onToggle={() => {
                        setExpandedId((cur) => (cur === attempt.id ? null : attempt.id));
                      }}
                    />
                  );
                })}
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

  const today = useToday();
  const stages = useMemo(
    () => computeStages(status, attempt.stage),
    [status, attempt.stage],
  );

  // Compute Next Event
  const nextEvent = useMemo(() => {
    if (status === "tracking" || status === "applied") {
      return {
        title: "Admit Card Release",
        date: formatDate(attempt.exam_date) ?? "To be announced",
      };
    }
    if (status === "admit_card") {
      const days = today ? daysUntilFrom(today, attempt.exam_date) : null;
      const countdown =
        days !== null
          ? days === 0
            ? "Today"
            : days > 0
              ? `In ${String(days)} days`
              : "Completed"
          : null;
      return {
        title: attempt.stage ? `${attempt.stage} Examination` : "Written Examination",
        date: [formatDate(attempt.exam_date), countdown].filter(Boolean).join(" · "),
      };
    }
    if (status === "appeared") {
      return {
        title: "Result Declaration",
        date: formatDate(attempt.result_date) ?? "Expected soon",
      };
    }
    return null;
  }, [status, attempt.exam_date, attempt.result_date, attempt.stage, today]);

  // Key Dates
  const keyDates = useMemo(() => {
    const dates: { label: string; date: string }[] = [];
    if (attempt.applied_at) {
      dates.push({ label: "Application Submitted", date: formatDate(attempt.applied_at) ?? "" });
    }
    if (attempt.exam_date) {
      dates.push({ label: "Exam Date", date: formatDate(attempt.exam_date) ?? "" });
    }
    if (attempt.result_date) {
      dates.push({ label: "Result Declaration", date: formatDate(attempt.result_date) ?? "" });
    }
    return dates;
  }, [attempt.applied_at, attempt.exam_date, attempt.result_date]);

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
      return ["Download official scorecard and prepare for document verification / appointment."];
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
        <OrganizationBadge org={org} size="sm" />

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

      {/* Next Milestone Event Box */}
      {nextEvent ? (
        <div className="mx-4 mb-4 flex items-center gap-3 rounded-xl border border-border/70 bg-secondary/50 px-3.5 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="section-label text-brand-deep">Next</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-foreground">
              {nextEvent.title}
            </p>
            <p className="text-[12.5px] tabular-nums text-muted-foreground">{nextEvent.date}</p>
          </div>
          <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
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
            {/* Exam Progress Detailed Checklist */}
            <section aria-label="Exam Progress Details">
              <h4 className="section-label mb-2.5">Exam Progress</h4>
              <ul className="space-y-2">
                {stages.map((stage: Stage) => {
                  const done = stage.state === "completed";
                  return (
                    <li key={stage.key} className="flex items-center gap-2.5 text-sm">
                      {done ? (
                        <CheckCircleIcon
                          className="size-4 shrink-0 text-brand"
                          aria-hidden="true"
                        />
                      ) : (
                        <CircleIcon
                          className="size-4 shrink-0 text-muted-foreground/40"
                          aria-hidden="true"
                        />
                      )}
                      <span
                        className={
                          done ? "font-medium text-foreground" : "text-muted-foreground"
                        }
                      >
                        {stage.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>

            {/* Key Dates */}
            {keyDates.length > 0 ? (
              <section className="border-t border-border/70 pt-3.5" aria-label="Key Dates">
                <h4 className="section-label mb-2.5">Key Dates</h4>
                <dl className="space-y-2">
                  {keyDates.map((d) => (
                    <div
                      key={d.label}
                      className="grid grid-cols-[minmax(0,8rem)_1fr] items-baseline gap-2 text-sm"
                    >
                      <dt className="font-semibold tabular-nums text-foreground">{d.date}</dt>
                      <dd className="min-w-0 text-muted-foreground">{d.label}</dd>
                    </div>
                  ))}
                </dl>
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
                      <CheckIcon className="mt-0.5 size-3.5 shrink-0 stroke-[2.5]" aria-hidden="true" />
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
                <SubmitButton size="sm" pendingLabel="Saving…" className="h-8.5 rounded-lg px-3 text-xs">
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
