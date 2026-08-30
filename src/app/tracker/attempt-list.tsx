"use client";

import Link from "next/link";

import { useActionState, useState } from "react";

import { ChevronRightIcon, ClockIcon } from "@/components/icons";
import { useToday } from "@/components/jobs/today-provider";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { EMPTY_FORM_STATE } from "@/lib/auth/form-state";
import { cn } from "@/lib/cn";
import type { ExamAttempt } from "@/lib/db/queries/attempts";
import type { ExamStatusReport } from "@/lib/exams/report";
import { subjectKeyFor } from "@/lib/exams/subject";
import { daysUntilFrom, formatDate } from "@/lib/format/deadline";
import {
  ATTEMPT_STATUSES,
  STATUS_LABELS,
  STATUS_ORDER,
  STATUS_TONE,
  type AttemptStatus,
} from "@/lib/tracker/enums";
import { deleteAttemptAction, setAttemptStatusAction } from "@/lib/tracker/actions";
import { StatusPanel } from "./status-panel";

const STATUS_OPTIONS = ATTEMPT_STATUSES.map((s) => ({
  value: s,
  label: STATUS_LABELS[s],
}));

/**
 * The status tone, again, as a one-pixel spine down the left edge of the card.
 *
 * Not decoration: it is the same value the badge carries, in the one place a
 * list can be scanned without reading — the eye finds the amber card before it
 * finds the word "Admit card out". `neutral` deliberately stays grey, so a
 * tracker full of nothing-happening rows has no colour in it at all.
 */
const SPINE: Record<NonNullable<BadgeProps["tone"]>, string> = {
  neutral: "bg-line-strong",
  accent: "bg-accent",
  good: "bg-good",
  warn: "bg-warn",
  critical: "bg-critical",
  criticalSolid: "bg-critical",
};

/** Outcomes. A finished exam opens collapsed — it is history, not a to-do. */
const SETTLED: ReadonlySet<AttemptStatus> = new Set<AttemptStatus>([
  "passed",
  "failed",
  "withdrawn",
]);

/**
 * `reports` is keyed by subject rather than by attempt, because the cache is:
 * two attempts at the same exam in different years read the same answer, and
 * the page fetched them in one query rather than one per row.
 */
export function AttemptList({
  attempts,
  reports,
}: {
  attempts: ExamAttempt[];
  reports: Record<string, ExamStatusReport>;
}) {
  if (attempts.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-dashed border-line bg-surface px-4 py-10 text-center">
        <p className="text-sm font-semibold text-ink">Nothing tracked yet</p>
        <p className="mt-1 text-sm text-ink-3">
          Add your first exam below and this page will follow its dates for you.
        </p>
      </div>
    );
  }

  // Live things first, finished things last. The database orders by date, which
  // is right within a group but would otherwise mix a passed exam from March in
  // among the ones still to sit.
  const sorted = [...attempts].sort(
    (a, b) => STATUS_ORDER[a.status as AttemptStatus] - STATUS_ORDER[b.status as AttemptStatus],
  );

  const settled = sorted.filter((a) => SETTLED.has(a.status as AttemptStatus)).length;
  const live = sorted.length - settled;

  return (
    <>
      {/* A rule with a count on it, rather than a summary panel. The list is
          the content; this only tells the eye where it starts. */}
      <div className="mt-6 flex items-baseline justify-between gap-3 border-b border-line pb-1.5">
        <h2 className="cond text-2xs font-semibold tracking-wider text-ink-3 uppercase">
          Tracked exams
        </h2>
        <p className="cond tabular text-2xs tracking-wider text-ink-3 uppercase">
          {live > 0 ? `${String(live)} live` : null}
          {live > 0 && settled > 0 ? " · " : null}
          {settled > 0 ? `${String(settled)} finished` : null}
        </p>
      </div>

      <ul className="mt-3 flex flex-col gap-3">
        {sorted.map((attempt) => {
          const key = subjectKeyFor(attempt);
          return (
            <AttemptRow
              key={attempt.id}
              attempt={attempt}
              report={(key === null ? undefined : reports[key]) ?? null}
            />
          );
        })}
      </ul>
    </>
  );
}

function AttemptRow({
  attempt,
  report,
}: {
  attempt: ExamAttempt;
  report: ExamStatusReport | null;
}) {
  const [, statusAction] = useActionState(setAttemptStatusAction, EMPTY_FORM_STATE);
  const [, removeAction] = useActionState(deleteAttemptAction, EMPTY_FORM_STATE);

  const status = attempt.status as AttemptStatus;

  // Open unless the exam is over and the answer is known. Somebody with eight
  // years of attempts behind them should land on the two that are still live,
  // not on a page they have to scroll past their own history to read.
  const [open, setOpen] = useState(!SETTLED.has(status));

  const today = useToday();

  // A row tracked from a job page carries neither an exam nor a typed name —
  // its subject is the notification, and the title lives there rather than
  // being copied into `custom_name`, which is the field most likely to be
  // corrected upstream.
  const name =
    attempt.exam?.name ?? attempt.custom_name ?? attempt.job?.title ?? "Untitled exam";

  // Stage and short name read as one line of provenance: "Prelims · SSC CGL".
  const sub = [attempt.stage, attempt.exam?.short_name].filter(Boolean).join(" · ");

  const countdown = nextMilestone(today, attempt.exam_date, attempt.result_date);
  const bodyId = `attempt-${attempt.id}`;

  return (
    <li className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="flex">
        <span className={cn("w-1 shrink-0", SPINE[STATUS_TONE[status]])} aria-hidden />

        <div className="min-w-0 flex-1">
          {/* The whole head is the toggle, so the tap target is the card rather
              than a 16px chevron. Every link that used to live up here moved
              into the body for exactly that reason — a link inside a button is
              not operable by keyboard. */}
          <button
            type="button"
            onClick={() => {
              setOpen((v) => !v);
            }}
            aria-expanded={open}
            aria-controls={bodyId}
            className={cn(
              "group flex w-full items-start gap-3 px-4 py-3 text-left",
              "transition-colors duration-(--duration-fast) hover:bg-surface-2/50",
              // Drawn inside the button rather than around it. The card clips
              // its own overflow so the spine can take its rounded corner, and
              // an outline at the default `+2px` offset would be clipped on
              // three sides — a focus ring only a sighted mouse user could
              // afford to miss.
              "focus-visible:-outline-offset-2",
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-base leading-snug font-bold text-ink">
                {name}
              </span>

              {sub ? (
                <span className="cond mt-0.5 line-clamp-1 block text-xs text-ink-2">{sub}</span>
              ) : null}

              <span className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Badge>
                {countdown ? (
                  <Badge tone={countdown.tone} className="tabular">
                    <ClockIcon className="size-3" />
                    {countdown.label}
                  </Badge>
                ) : null}
              </span>
            </span>

            <span
              className={cn(
                "mt-0.5 shrink-0 rounded-md p-1 text-ink-3",
                "transition-colors duration-(--duration-fast)",
                "group-hover:bg-surface-2 group-hover:text-ink",
              )}
            >
              <ChevronRightIcon
                className={cn(
                  "size-4 transition-transform duration-(--duration-fast)",
                  open && "rotate-90",
                )}
              />
              <span className="sr-only">{open ? `Collapse ${name}` : `Expand ${name}`}</span>
            </span>
          </button>

          <div id={bodyId} hidden={!open}>
            <Dates attempt={attempt} today={today} />

            {attempt.notes ? (
              <p className="border-t border-line px-4 py-3 text-sm leading-6 text-ink-2">
                {attempt.notes}
              </p>
            ) : null}

            {/* Back to the notification this was tracked from. Without it the
                row is a dead end: someone checking their tracker for a deadline
                then has to search for the listing by name. */}
            {attempt.job ? (
              <p className="border-t border-line px-4 py-2.5">
                <Link
                  href={`/jobs/${attempt.job.slug}`}
                  className="inline-flex items-center gap-0.5 text-xs font-semibold text-accent hover:underline"
                >
                  View the notification
                  <ChevronRightIcon className="size-3.5" />
                </Link>
              </p>
            ) : null}

            {/* Below the row's own facts rather than above them. The fields are
                what its owner came to change; the researched answer is what
                they came to read, and reading happens after the row has
                identified itself. */}
            <StatusPanel attemptId={attempt.id} name={name} initial={report} />

            {/* The controls sit last and on a tinted ground, so a card reads as
                content with a toolbar under it rather than as a form. */}
            <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-2/40 px-4 py-3">
              {/* A form per row rather than one form with a row id: submitting
                  the status of one exam must never carry another row's fields
                  with it. */}
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
                  placeholder="Status"
                  className="h-8 w-36 text-xs sm:w-44"
                />
                <SubmitButton size="sm" pendingLabel="Saving…">
                  Update
                </SubmitButton>
              </form>

              <form action={removeAction} className="ml-auto">
                <input type="hidden" name="id" value={attempt.id} />
                <SubmitButton variant="ghost" size="sm" pendingLabel="Removing…">
                  Remove
                </SubmitButton>
              </form>
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

/* ── Dates ─────────────────────────────────────────────────────────────── */

/**
 * The row's own dates, as separate objects rather than one grey sentence.
 *
 * They used to render as `Exam 12 Mar 2026 · Result 20 Apr 2026 · Roll 4410021`
 * in `text-ink-3` — three unrelated facts fused into a line that reads as
 * noise. A date is the thing this page exists to show, so each gets a label it
 * can be found by and a value set in the same weight as the exam's own name.
 */
function Dates({ attempt, today }: { attempt: ExamAttempt; today: string | null }) {
  const examDate = formatDate(attempt.exam_date);
  const resultDate = formatDate(attempt.result_date);
  const appliedAt = formatDate(attempt.applied_at);

  const facts: { label: string; value: string; note?: string | null }[] = [];

  if (examDate)
    facts.push({ label: "Exam", value: examDate, note: relative(today, attempt.exam_date) });
  if (resultDate)
    facts.push({
      label: "Result",
      value: resultDate,
      note: relative(today, attempt.result_date),
    });
  if (appliedAt) facts.push({ label: "Applied", value: appliedAt });
  if (attempt.roll_number) facts.push({ label: "Roll number", value: attempt.roll_number });
  if (attempt.score !== null) facts.push({ label: "Score", value: String(attempt.score) });

  if (facts.length === 0) {
    return (
      <p className="border-t border-line px-4 py-3 text-xs text-ink-3">
        No dates saved on this one yet. A status check below fills them in when it finds them.
      </p>
    );
  }

  return (
    <dl className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
      {facts.map((fact) => (
        <div
          key={fact.label}
          className="rounded-md border border-line bg-surface-2/60 px-3 py-1.5"
        >
          <dt className="cond text-2xs font-semibold tracking-wider text-ink-3 uppercase">
            {fact.label}
          </dt>
          <dd className="tabular text-sm font-semibold whitespace-nowrap text-ink">
            {fact.value}
            {fact.note ? (
              <span className="ml-1.5 text-2xs font-medium text-ink-3">{fact.note}</span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ── Countdowns ────────────────────────────────────────────────────────── */

/**
 * The one date worth carrying in a collapsed head: the next thing to happen.
 *
 * The exam if it is still ahead, otherwise the result. Returns null before
 * hydration, when `today` is null — see `TodayProvider` for why the server
 * cannot know the reader's calendar day.
 */
function nextMilestone(
  today: string | null,
  examDate: string | null,
  resultDate: string | null,
): { label: string; tone: NonNullable<BadgeProps["tone"]> } | null {
  if (today === null) return null;

  const toExam = daysUntilFrom(today, examDate);
  if (toExam !== null && toExam >= 0) {
    if (toExam === 0) return { label: "Exam today", tone: "criticalSolid" };
    return {
      label: `Exam in ${String(toExam)} ${toExam === 1 ? "day" : "days"}`,
      tone: toExam <= 7 ? "warn" : "neutral",
    };
  }

  const toResult = daysUntilFrom(today, resultDate);
  if (toResult !== null && toResult >= 0) {
    if (toResult === 0) return { label: "Result today", tone: "accent" };
    return {
      label: `Result in ${String(toResult)} ${toResult === 1 ? "day" : "days"}`,
      tone: "accent",
    };
  }

  return null;
}

/** "in 12 days" / "today" / "8 days ago", or null when it cannot be known yet. */
function relative(today: string | null, date: string | null): string | null {
  if (today === null) return null;

  const days = daysUntilFrom(today, date);
  if (days === null) return null;
  if (days === 0) return "today";
  if (days > 0) return `in ${String(days)} ${days === 1 ? "day" : "days"}`;
  const ago = Math.abs(days);
  return `${String(ago)} ${ago === 1 ? "day" : "days"} ago`;
}
