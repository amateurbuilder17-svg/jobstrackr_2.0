"use client";

import { useActionState } from "react";

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
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-ink">Qualifications</h2>
        <p className="mt-1 text-sm text-ink-2">
          One entry per level. Adding a level you already have replaces it.
        </p>
      </div>

      {education.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {education.map((row) => (
            <EducationRow key={row.id} row={row} />
          ))}
        </ul>
      ) : (
        <p className="rounded-md border border-dashed border-line px-3 py-4 text-sm text-ink-3">
          Nothing added yet.
        </p>
      )}

      <form
        action={formAction}
        className="mt-2 flex flex-col gap-4 rounded-lg border border-line bg-surface p-4"
      >
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

        <div>
          <SubmitButton variant="secondary" pendingLabel="Saving…">
            Add qualification
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}

function EducationRow({ row }: { row: EducationRow }) {
  const [, deleteAction] = useActionState(deleteEducationAction, EMPTY_FORM_STATE);

  const detail = [row.discipline, row.board_university, row.year_of_passing]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{QUALIFICATION_LABELS[row.level]}</p>
        {detail ? <p className="truncate text-xs text-ink-3">{detail}</p> : null}
      </div>

      <form action={deleteAction}>
        <input type="hidden" name="id" value={row.id} />
        <SubmitButton variant="ghost" size="sm" pendingLabel="Removing…">
          Remove
        </SubmitButton>
      </form>
    </li>
  );
}
