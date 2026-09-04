"use client";

import { useActionState, useState } from "react";

import { ChevronDownIcon, SlidersHorizontalIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
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
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  const sectorCount = profile ? profile.preferred_sectors.length : 0;
  const stateCount = profile ? profile.preferred_states.length : 0;

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

      {/* Collapsible Bar for Preferred Sectors and States */}
      <div className="overflow-hidden rounded-2xl border border-line bg-surface-2/40 transition-all duration-200">
        <button
          type="button"
          onClick={() => {
            setPreferencesOpen((prev) => !prev);
          }}
          aria-expanded={preferencesOpen}
          className="flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-surface-2/70 focus:outline-none"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 sm:size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
              <SlidersHorizontalIcon className="size-4 sm:size-4.5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-bold text-ink sm:text-base">
                  Job preferences (Sectors & States)
                </span>
                <span className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-ink-3">
                  Optional
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-ink-3">
                {sectorCount > 0 || stateCount > 0
                  ? `${String(sectorCount)} sectors · ${String(stateCount)} states configured`
                  : "Tap to set preferred recruitment sectors and posting locations"}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-brand">
            <span>{preferencesOpen ? "Hide" : "Open"}</span>
            <ChevronDownIcon
              className={cn(
                "size-4 text-ink-3 transition-transform duration-200",
                preferencesOpen && "rotate-180 text-brand",
              )}
              aria-hidden="true"
            />
          </div>
        </button>

        {/* Collapsible Body */}
        <div
          className={cn(
            "space-y-6 border-t border-line/60 bg-surface px-4 py-5 sm:px-5",
            !preferencesOpen && "hidden",
          )}
        >
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
        </div>
      </div>

      <div className="pt-2">
        <SubmitButton
          variant="primary"
          size="lg"
          pendingLabel="Saving profile…"
          className="w-full sm:w-auto rounded-xl bg-brand font-semibold text-white shadow-xs transition-colors hover:bg-brand-deep"
        >
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
    <fieldset className="flex flex-col gap-2.5">
      <legend className="text-xs font-bold uppercase tracking-wider text-ink-2">
        {legend}
      </legend>

      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className="flex cursor-pointer select-none items-center gap-2 rounded-xl border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink-2 transition-all hover:border-line-strong hover:bg-surface-2 has-checked:border-brand has-checked:bg-brand-soft has-checked:font-semibold has-checked:text-brand sm:text-sm"
          >
            <input
              type="checkbox"
              name={name}
              value={o.value}
              defaultChecked={chosen.has(o.value)}
              className="size-3.5 rounded accent-brand"
            />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
