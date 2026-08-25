"use client";

import { useActionState } from "react";

import { Field, FormError, FormNotice, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { EMPTY_FORM_STATE } from "@/lib/auth/form-state";
import { completeMatchProfileAction } from "@/lib/profile/actions";
import { QUALIFICATION_LABELS, QUALIFICATION_LEVELS } from "@/lib/profile/enums";

/**
 * The three fields that turn an empty feed into a feed.
 *
 * Not a wizard, and not a link. The old app asked these through six steps on a
 * route of their own, which is a lot of ceremony for three answers; the version
 * before this one sent people to /profile and left them to find their way back.
 *
 * Both were solving the wrong problem. The page is empty because the matcher
 * hard-filters on age, level and discipline — so the fix belongs on this page,
 * directly above the space it explains, and it should take one submission.
 */
const LEVEL_OPTIONS = QUALIFICATION_LEVELS.map((level) => ({
  value: level,
  label: QUALIFICATION_LABELS[level],
}));

export function CompleteMatchProfile({
  dateOfBirth,
  highestQualification,
  discipline,
}: {
  dateOfBirth: string | null;
  highestQualification: string | null;
  discipline: string | null;
}) {
  const [state, action] = useActionState(completeMatchProfileAction, EMPTY_FORM_STATE);

  return (
    <form
      action={action}
      className="mt-6 rounded-lg border border-accent-line bg-accent-soft/50 p-4"
    >
      <h2 className="text-base font-semibold text-ink">Three answers and this page fills in</h2>
      <p className="mt-1 text-sm text-ink-2">
        Every notification states an age limit and a qualification, and this feed will not guess
        at either — so it needs both before it can show you anything.
      </p>

      <FormError>{state.errors?.form}</FormError>
      {state.ok ? <FormNotice>{state.message}</FormNotice> : null}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field id="dateOfBirth" label="Date of birth" error={state.errors?.dateOfBirth}>
          <Input
            id="dateOfBirth"
            name="dateOfBirth"
            type="date"
            defaultValue={dateOfBirth ?? ""}
            error={state.errors?.dateOfBirth}
            required
          />
        </Field>

        <Field
          id="highestQualification"
          label="Highest qualification"
          error={state.errors?.highestQualification}
        >
          <Select
            id="highestQualification"
            name="highestQualification"
            options={LEVEL_OPTIONS}
            defaultValue={highestQualification ?? ""}
            placeholder="Choose one"
            error={state.errors?.highestQualification}
          />
        </Field>

        <Field
          id="discipline"
          label="Subject or discipline"
          optional
          hint="B.A. History, B.Tech Civil, B.Sc Nursing. Without it you will only see postings open to any discipline."
          error={state.errors?.discipline}
        >
          <Input
            id="discipline"
            name="discipline"
            defaultValue={discipline ?? ""}
            placeholder="e.g. Civil Engineering"
            error={state.errors?.discipline}
          />
        </Field>
      </div>

      <div className="mt-4">
        <SubmitButton variant="primary" pendingLabel="Saving…">
          Save and show my matches
        </SubmitButton>
      </div>
    </form>
  );
}
