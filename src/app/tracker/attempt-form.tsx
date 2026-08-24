"use client";

import { useActionState, useState } from "react";

import { Field, FormError, FormNotice, Input, Select, Textarea } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { EMPTY_FORM_STATE } from "@/lib/auth/form-state";
import type { ExamOption } from "@/lib/db/queries/attempts";
import { ATTEMPT_STATUSES, STATUS_LABELS } from "@/lib/tracker/enums";
import { saveAttemptAction } from "@/lib/tracker/actions";

const STATUS_OPTIONS = ATTEMPT_STATUSES.map((s) => ({
  value: s,
  label: STATUS_LABELS[s],
}));

/**
 * Add an exam to the tracker.
 *
 * Collapsed by default. This page is for reading what is coming up; the form is
 * used once per exam and would otherwise push the list — the actual content —
 * below the fold on a phone.
 */
export function AttemptForm({ exams }: { exams: ExamOption[] }) {
  const [state, formAction] = useActionState(saveAttemptAction, EMPTY_FORM_STATE);
  const [open, setOpen] = useState(false);

  const examOptions = exams.map((e) => ({
    value: e.id,
    label: e.short_name ? `${e.name} (${e.short_name})` : e.name,
  }));

  if (!open) {
    return (
      <div className="mt-6">
        <Button
          variant="primary"
          onClick={() => {
            setOpen(true);
          }}
        >
          Add an exam
        </Button>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      className="mt-6 flex flex-col gap-4 rounded-lg border border-line bg-surface p-4"
    >
      <h2 className="text-sm font-semibold text-ink">Add an exam</h2>

      <FormError>{state.errors?.form}</FormError>
      {state.ok && state.message ? <FormNotice>{state.message}</FormNotice> : null}

      <Field
        id="examId"
        label="Exam"
        optional
        error={state.errors?.examId}
        hint="Pick from the list, or type a name below if it is not there."
      >
        <Select id="examId" options={examOptions} placeholder="Choose an exam…" />
      </Field>

      <Field
        id="customName"
        label="Or type the exam name"
        optional
        error={state.errors?.customName}
      >
        <Input id="customName" error={state.errors?.customName} />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="status" label="Status" error={state.errors?.status}>
          <Select
            id="status"
            options={STATUS_OPTIONS}
            defaultValue="tracking"
            placeholder="Status"
            error={state.errors?.status}
          />
        </Field>

        <Field
          id="stage"
          label="Stage"
          optional
          error={state.errors?.stage}
          hint="Prelims, Mains, Interview…"
        >
          <Input id="stage" error={state.errors?.stage} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="appliedAt" label="Applied on" optional error={state.errors?.appliedAt}>
          <Input id="appliedAt" type="date" error={state.errors?.appliedAt} />
        </Field>
        <Field id="examDate" label="Exam date" optional error={state.errors?.examDate}>
          <Input id="examDate" type="date" error={state.errors?.examDate} />
        </Field>
        <Field id="resultDate" label="Result date" optional error={state.errors?.resultDate}>
          <Input id="resultDate" type="date" error={state.errors?.resultDate} />
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="rollNumber" label="Roll number" optional error={state.errors?.rollNumber}>
          <Input id="rollNumber" error={state.errors?.rollNumber} />
        </Field>
        <Field id="score" label="Score" optional error={state.errors?.score}>
          <Input id="score" type="number" step="0.01" error={state.errors?.score} />
        </Field>
      </div>

      <Field id="notes" label="Notes" optional error={state.errors?.notes}>
        <Textarea id="notes" error={state.errors?.notes} />
      </Field>

      <div className="flex items-center gap-2">
        <SubmitButton variant="primary" pendingLabel="Saving…">
          Save exam
        </SubmitButton>
        {/* A plain Button, not a SubmitButton: SubmitButton renders
            type="submit", so Cancel would save the form it is meant to
            abandon. */}
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
