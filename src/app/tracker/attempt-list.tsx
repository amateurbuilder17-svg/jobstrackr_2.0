"use client";

import Link from "next/link";

import { useActionState } from "react";

import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { EMPTY_FORM_STATE } from "@/lib/auth/form-state";
import type { ExamAttempt } from "@/lib/db/queries/attempts";
import { formatDate } from "@/lib/format/deadline";
import {
  ATTEMPT_STATUSES,
  STATUS_LABELS,
  STATUS_ORDER,
  STATUS_TONE,
  type AttemptStatus,
} from "@/lib/tracker/enums";
import { deleteAttemptAction, setAttemptStatusAction } from "@/lib/tracker/actions";

const STATUS_OPTIONS = ATTEMPT_STATUSES.map((s) => ({
  value: s,
  label: STATUS_LABELS[s],
}));

export function AttemptList({ attempts }: { attempts: ExamAttempt[] }) {
  if (attempts.length === 0) {
    return (
      <p className="mt-6 rounded-lg border border-dashed border-line px-4 py-10 text-center text-sm text-ink-2">
        Nothing tracked yet. Add your first exam below.
      </p>
    );
  }

  // Live things first, finished things last. The database orders by date, which
  // is right within a group but would otherwise mix a passed exam from March in
  // among the ones still to sit.
  const sorted = [...attempts].sort(
    (a, b) => STATUS_ORDER[a.status as AttemptStatus] - STATUS_ORDER[b.status as AttemptStatus],
  );

  return (
    <ul className="mt-6 flex flex-col gap-3">
      {sorted.map((attempt) => (
        <AttemptRow key={attempt.id} attempt={attempt} />
      ))}
    </ul>
  );
}

function AttemptRow({ attempt }: { attempt: ExamAttempt }) {
  const [, statusAction] = useActionState(setAttemptStatusAction, EMPTY_FORM_STATE);
  const [, removeAction] = useActionState(deleteAttemptAction, EMPTY_FORM_STATE);

  const status = attempt.status as AttemptStatus;
  // A row tracked from a job page carries neither an exam nor a typed name —
  // its subject is the notification, and the title lives there rather than
  // being copied into `custom_name`, which is the field most likely to be
  // corrected upstream.
  const name =
    attempt.exam?.name ?? attempt.custom_name ?? attempt.job?.title ?? "Untitled exam";

  // Formatted first, then tested. `formatDate` returns null for a date it
  // cannot parse, so testing the raw column would produce "Exam null".
  const examDate = formatDate(attempt.exam_date);
  const resultDate = formatDate(attempt.result_date);

  const dates = [
    examDate ? `Exam ${examDate}` : null,
    resultDate ? `Result ${resultDate}` : null,
    attempt.roll_number ? `Roll ${attempt.roll_number}` : null,
  ].filter(Boolean);

  return (
    <li className="rounded-lg border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-ink">{name}</p>
          {attempt.stage ? (
            <p className="truncate text-xs text-ink-3">{attempt.stage}</p>
          ) : null}
          {/* Back to the notification this was tracked from. Without it the
              row is a dead end: someone checking their tracker for a deadline
              then has to search for the listing by name. */}
          {attempt.job ? (
            <Link
              href={`/jobs/${attempt.job.slug}`}
              className="mt-0.5 inline-block text-xs font-medium text-accent hover:underline"
            >
              View the notification
            </Link>
          ) : null}
        </div>
        <Badge tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Badge>
      </div>

      {dates.length > 0 ? <p className="mt-2 text-xs text-ink-3">{dates.join(" · ")}</p> : null}

      <div className="mt-3 flex items-center gap-2">
        {/* A form per row rather than one form with a row id: submitting the
            status of one exam must never carry another row's fields with it. */}
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
            className="h-8 w-44 text-xs"
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
    </li>
  );
}
