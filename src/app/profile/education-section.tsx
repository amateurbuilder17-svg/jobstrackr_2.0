"use client";

import { useActionState } from "react";

import { GraduationCapIcon, PlusIcon } from "@/components/icons";
import { EMPTY_FORM_STATE } from "@/lib/auth/form-state";
import { QUALIFICATION_LABELS, QUALIFICATION_LEVELS } from "@/lib/profile/enums";
import { deleteEducationAction, upsertEducationAction } from "@/lib/profile/actions";
import type { EducationRow } from "@/lib/profile/columns";
import { Field, FormError, FormNotice, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

const LEVEL_OPTIONS = QUALIFICATION_LEVELS.map((q) => ({
  value: q,
  label: QUALIFICATION_LABELS[q],
}));

export function EducationSection({ education }: { education: EducationRow[] }) {
  const [state, formAction] = useActionState(upsertEducationAction, EMPTY_FORM_STATE);

  return (
    <div className="flex flex-col gap-4">
      {education.length > 0 ? (
        <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
          {education.map((row) => (
            <EducationRowItem key={row.id} row={row} />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-line bg-surface/40 p-6 text-center sm:p-8">
          <div className="mx-auto flex size-11 items-center justify-center rounded-2xl border border-line bg-logo-plate text-ink-3 shadow-xs">
            <GraduationCapIcon className="size-5 text-brand" aria-hidden="true" />
          </div>
          <p className="mt-2.5 text-sm font-semibold text-ink">No qualifications added yet</p>
          <p className="mt-1 text-xs text-ink-3">
            Add your degrees or certificates below to enable automatic eligibility checks.
          </p>
        </div>
      )}

      <form
        action={formAction}
        className="mt-2 flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4 sm:p-5 shadow-xs"
      >
        <div className="flex items-center gap-2 border-b border-line/60 pb-3">
          <div className="flex size-7 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <PlusIcon className="size-4" aria-hidden="true" />
          </div>
          <span className="text-sm font-bold text-ink">Add a qualification</span>
        </div>

        <FormError>{state.errors?.form}</FormError>
        {state.ok && state.message ? <FormNotice>{state.message}</FormNotice> : null}

        <Field id="level" label="Level" error={state.errors?.level}>
          <Select
            id="level"
            options={LEVEL_OPTIONS}
            required
            placeholder="Select a level…"
            error={state.errors?.level}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="discipline" label="Discipline" optional error={state.errors?.discipline}>
            <Input id="discipline" error={state.errors?.discipline} />
          </Field>

          <Field
            id="boardUniversity"
            label="Board or university"
            optional
            error={state.errors?.boardUniversity}
          >
            <Input id="boardUniversity" error={state.errors?.boardUniversity} />
          </Field>
        </div>

        <Field id="institution" label="Institution" optional error={state.errors?.institution}>
          <Input id="institution" error={state.errors?.institution} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="yearOfPassing"
            label="Year of passing"
            optional
            error={state.errors?.yearOfPassing}
          >
            <Input
              id="yearOfPassing"
              type="number"
              inputMode="numeric"
              min={1950}
              error={state.errors?.yearOfPassing}
            />
          </Field>

          <Field id="percentage" label="Percentage" optional error={state.errors?.percentage}>
            <Input
              id="percentage"
              type="number"
              inputMode="decimal"
              min={0}
              max={100}
              step="0.01"
              error={state.errors?.percentage}
            />
          </Field>
        </div>

        <div className="pt-1">
          <SubmitButton
            variant="secondary"
            size="md"
            pendingLabel="Saving…"
            className="rounded-xl border border-line bg-surface font-semibold text-ink shadow-2xs transition-colors hover:border-line-strong hover:bg-surface-2"
          >
            Add qualification
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}

function EducationRowItem({ row }: { row: EducationRow }) {
  const [, deleteAction] = useActionState(deleteEducationAction, EMPTY_FORM_STATE);

  const detail = [row.discipline, row.board_university, row.institution]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 transition-colors duration-(--duration-fast) hover:bg-surface-2/40 sm:px-5 sm:py-3.5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-ink sm:text-base">
            {QUALIFICATION_LABELS[row.level]}
          </span>
          {row.year_of_passing ? (
            <span className="tabular rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink-3">
              {row.year_of_passing}
            </span>
          ) : null}
          {row.percentage !== null ? (
            <span className="tabular rounded-full border border-good/30 bg-good-soft px-2 py-0.5 text-xs font-semibold text-good">
              {row.percentage}%
            </span>
          ) : null}
        </div>
        {detail ? <p className="mt-0.5 truncate text-xs text-ink-3">{detail}</p> : null}
      </div>

      <form action={deleteAction} className="shrink-0">
        <input type="hidden" name="id" value={row.id} />
        <SubmitButton
          variant="ghost"
          size="sm"
          pendingLabel="Removing…"
          className="rounded-xl border border-line bg-surface text-ink-2 transition-colors hover:border-critical/40 hover:bg-critical-soft/30 hover:text-critical"
        >
          Remove
        </SubmitButton>
      </form>
    </div>
  );
}
