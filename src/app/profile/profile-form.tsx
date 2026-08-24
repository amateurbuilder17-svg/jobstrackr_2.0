"use client";

import { useActionState } from "react";

import { EMPTY_FORM_STATE } from "@/lib/auth/form-state";
import {
  CATEGORY_LABELS,
  GENDERS,
  QUALIFICATION_LABELS,
  QUALIFICATION_LEVELS,
  RESERVATION_CATEGORIES,
} from "@/lib/profile/enums";
import { updateProfileAction } from "@/lib/profile/actions";
import type { Profile } from "@/lib/auth/session";
import { INDIAN_STATES, SECTORS } from "@/lib/vocab";
import { Field, FormError, FormNotice, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

const GENDER_OPTIONS = GENDERS.filter((g) => g !== "any").map((g) => ({
  value: g,
  label: g === "male" ? "Male" : "Female",
}));

const CATEGORY_OPTIONS = RESERVATION_CATEGORIES.map((c) => ({
  value: c,
  label: CATEGORY_LABELS[c],
}));

const QUALIFICATION_OPTIONS = QUALIFICATION_LEVELS.map((q) => ({
  value: q,
  label: QUALIFICATION_LABELS[q],
}));

const STATE_OPTIONS = INDIAN_STATES.map((s) => ({ value: s, label: s }));

export function ProfileForm({ profile }: { profile: Profile | null }) {
  const [state, formAction] = useActionState(updateProfileAction, EMPTY_FORM_STATE);

  // Uncontrolled inputs with defaultValue: the server already knows the saved
  // values, and mirroring them into React state would buy nothing but a
  // re-render per keystroke on a form with sixteen fields.
  return (
    <form action={formAction} className="flex flex-col gap-5">
      <FormError>{state.errors?.form}</FormError>
      {state.ok && state.message ? <FormNotice>{state.message}</FormNotice> : null}

      <Field id="fullName" label="Full name" error={state.errors?.fullName}>
        <Input
          id="fullName"
          autoComplete="name"
          required
          defaultValue={profile?.full_name ?? ""}
          error={state.errors?.fullName}
        />
      </Field>

      <Field
        id="phone"
        label="Mobile number"
        optional
        error={state.errors?.phone}
        hint="10 digits, used for exam reminders."
      >
        <Input
          id="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          defaultValue={profile?.phone ?? ""}
          error={state.errors?.phone}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="dateOfBirth"
          label="Date of birth"
          optional
          error={state.errors?.dateOfBirth}
          hint="Used for age-limit checks."
        >
          <Input
            id="dateOfBirth"
            type="date"
            defaultValue={profile?.date_of_birth ?? ""}
            error={state.errors?.dateOfBirth}
          />
        </Field>

        <Field id="gender" label="Gender" optional error={state.errors?.gender}>
          <Select
            id="gender"
            options={GENDER_OPTIONS}
            defaultValue={profile?.gender ?? ""}
            error={state.errors?.gender}
          />
        </Field>
      </div>

      <Field
        id="category"
        label="Category"
        optional
        error={state.errors?.category}
        hint="Affects age relaxation and fee concessions."
      >
        <Select
          id="category"
          options={CATEGORY_OPTIONS}
          defaultValue={profile?.category ?? ""}
          error={state.errors?.category}
        />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="state" label="State" optional error={state.errors?.state}>
          <Select
            id="state"
            options={STATE_OPTIONS}
            defaultValue={profile?.state ?? ""}
            error={state.errors?.state}
          />
        </Field>

        <Field id="district" label="District" optional error={state.errors?.district}>
          <Input
            id="district"
            defaultValue={profile?.district ?? ""}
            error={state.errors?.district}
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="highestQualification"
          label="Highest qualification"
          optional
          error={state.errors?.highestQualification}
        >
          <Select
            id="highestQualification"
            options={QUALIFICATION_OPTIONS}
            defaultValue={profile?.highest_qualification ?? ""}
            error={state.errors?.highestQualification}
          />
        </Field>

        <Field
          id="experienceYears"
          label="Years of experience"
          optional
          error={state.errors?.experienceYears}
        >
          <Input
            id="experienceYears"
            type="number"
            min={0}
            max={60}
            step={1}
            defaultValue={profile?.experience_years ?? ""}
            error={state.errors?.experienceYears}
          />
        </Field>
      </div>

      <CheckboxGroup
        legend="Preferred sectors"
        name="preferredSectors"
        options={SECTORS.map((s) => ({ value: s.value, label: s.label }))}
        selected={profile?.preferred_sectors ?? []}
      />

      <CheckboxGroup
        legend="Preferred states"
        name="preferredStates"
        options={STATE_OPTIONS}
        selected={profile?.preferred_states ?? []}
      />

      <div>
        <SubmitButton variant="primary" size="lg" pendingLabel="Saving…">
          Save profile
        </SubmitButton>
      </div>
    </form>
  );
}

/**
 * Checkboxes rather than a `<select multiple>`: multi-select is close to
 * unusable on a phone, and this app's traffic is overwhelmingly mobile. Every
 * box shares one `name`, so the action reads them with `getAll`.
 */
function CheckboxGroup({
  legend,
  name,
  options,
  selected,
}: {
  legend: string;
  name: string;
  options: readonly { value: string; label: string }[];
  selected: readonly string[];
}) {
  const chosen = new Set(selected);

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium text-ink">
        {legend} <span className="ml-1 text-xs font-normal text-ink-3">Optional</span>
      </legend>

      <div className="mt-1 flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer items-center gap-2 rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-ink-2 transition-colors hover:border-line-strong has-checked:border-accent has-checked:bg-accent/10 has-checked:text-ink"
          >
            <input
              type="checkbox"
              name={name}
              value={o.value}
              defaultChecked={chosen.has(o.value)}
              className="size-3.5 accent-accent"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
