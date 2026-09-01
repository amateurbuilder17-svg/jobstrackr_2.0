"use client";

import { useActionState, useEffect, useState } from "react";

import { CloseIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Field, FormError, FormNotice, Input, Select, Textarea } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { EMPTY_FORM_STATE } from "@/lib/auth/form-state";
import type { ExamOption } from "@/lib/db/queries/attempts";
import { saveAttemptAction } from "@/lib/tracker/actions";
import { ATTEMPT_STATUSES, STATUS_LABELS } from "@/lib/tracker/enums";

const STATUS_OPTIONS = ATTEMPT_STATUSES.map((s) => ({
  value: s,
  label: STATUS_LABELS[s],
}));

export function AttemptForm({
  exams,
  open: externalOpen,
  onClose: externalOnClose,
}: {
  exams: ExamOption[];
  open?: boolean;
  onClose?: () => void;
}) {
  const [state, formAction] = useActionState(saveAttemptAction, EMPTY_FORM_STATE);
  const [internalOpen, setInternalOpen] = useState(false);

  const isControlled = externalOpen !== undefined;
  const isOpen = isControlled ? externalOpen : internalOpen;

  const handleClose = () => {
    if (externalOnClose) {
      externalOnClose();
    } else {
      setInternalOpen(false);
    }
  };

  // Close modal when form successfully saves
  useEffect(() => {
    if (state.ok) {
      const timer = setTimeout(() => {
        if (externalOnClose) {
          externalOnClose();
        } else {
          setInternalOpen(false);
        }
      }, 1200);
      return () => {
        clearTimeout(timer);
      };
    }
  }, [state.ok, externalOnClose]);

  const examOptions = exams.map((e) => ({
    value: e.id,
    label: e.short_name ? `${e.name} (${e.short_name})` : e.name,
  }));

  if (!isOpen) {
    if (isControlled) return null;
    return (
      <div className="mt-8 flex justify-center">
        <Button
          variant="primary"
          onClick={() => {
            setInternalOpen(true);
          }}
          className="h-10 rounded-xl px-5 font-semibold shadow-pill transition-all hover:bg-brand-deep active:scale-95"
        >
          + Track another exam
        </Button>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="track-exam-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div
        className="fixed inset-0"
        onClick={() => {
          handleClose();
        }}
        aria-hidden="true"
      />

      <form
        action={formAction}
        className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto flex flex-col gap-4.5 rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 animate-in zoom-in-95 duration-150"
      >
        <div className="flex items-center justify-between border-b border-border pb-3">
          <div>
            <h2 id="track-exam-modal-title" className="text-base font-bold text-foreground sm:text-lg">
              Track an exam
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Select a recognized government exam or type a custom recruitment.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              handleClose();
            }}
            aria-label="Close dialog"
            className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <CloseIcon className="size-4" aria-hidden="true" />
          </button>
        </div>

        <FormError>{state.errors?.form}</FormError>
        {state.ok && state.message ? <FormNotice>{state.message}</FormNotice> : null}

        <Field
          id="examId"
          label="Select Known Exam"
          optional
          error={state.errors?.examId}
          hint="Pick from our database of national & state exams, or enter a custom name below."
        >
          <Select id="examId" options={examOptions} placeholder="Choose an exam…" />
        </Field>

        <Field
          id="customName"
          label="Or Custom Exam Name"
          optional
          error={state.errors?.customName}
          hint="e.g. WBPSC Food SI 2026, Rajasthan CET, ISRO Scientist/Engineer"
        >
          <Input id="customName" placeholder="Type exam or notification name" error={state.errors?.customName} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="status" label="Current Status" error={state.errors?.status}>
            <Select
              id="status"
              name="status"
              options={STATUS_OPTIONS}
              defaultValue="tracking"
              placeholder="Status"
              error={state.errors?.status}
            />
          </Field>

          <Field
            id="stage"
            label="Stage / Tier"
            optional
            error={state.errors?.stage}
            hint="e.g. Prelims, Mains, Tier 1"
          >
            <Input id="stage" placeholder="Prelims" error={state.errors?.stage} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="appliedAt" label="Applied On" optional error={state.errors?.appliedAt}>
            <Input id="appliedAt" type="date" error={state.errors?.appliedAt} />
          </Field>
          <Field id="examDate" label="Exam Date" optional error={state.errors?.examDate}>
            <Input id="examDate" type="date" error={state.errors?.examDate} />
          </Field>
          <Field id="resultDate" label="Result Date" optional error={state.errors?.resultDate}>
            <Input id="resultDate" type="date" error={state.errors?.resultDate} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="rollNumber" label="Roll / Reg Number" optional error={state.errors?.rollNumber}>
            <Input id="rollNumber" placeholder="e.g. 240100982" error={state.errors?.rollNumber} />
          </Field>
          <Field id="score" label="Score / Marks" optional error={state.errors?.score}>
            <Input id="score" type="number" step="0.01" placeholder="e.g. 142.50" error={state.errors?.score} />
          </Field>
        </div>

        <Field id="notes" label="Personal Notes" optional error={state.errors?.notes}>
          <Textarea id="notes" placeholder="Exam centre details, shift timings, study targets, etc." error={state.errors?.notes} />
        </Field>

        <div className="flex items-center justify-end gap-2.5 border-t border-border pt-4">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              handleClose();
            }}
            className="h-9 rounded-xl text-xs font-semibold"
          >
            Cancel
          </Button>
          <SubmitButton variant="primary" pendingLabel="Saving…" className="h-9 rounded-xl px-5 font-semibold shadow-pill">
            Save exam
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
