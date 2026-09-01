import type { FilterGroup } from "@/components/filters/filter-bar";
import type { JobListOptions, JobSort } from "@/lib/db/queries/jobs";
import { INDIAN_STATES, SECTORS } from "@/lib/vocab";

export const JOB_SORT_OPTIONS: { value: JobSort; label: string; desc: string }[] = [
  { value: "closing", label: "Closing soon", desc: "Deadlines happening soonest" },
  { value: "newest", label: "Newest first", desc: "Recently published postings" },
  { value: "vacancy", label: "Highest vacancy", desc: "Most available posts" },
];

export const FILTER_GROUPS: FilterGroup[] = [
  {
    param: "level",
    label: "Education level",
    iconName: "education",
    options: [
      { label: "Class 10", value: "class_10" },
      { label: "Class 12", value: "class_12" },
      { label: "ITI", value: "iti" },
      { label: "Diploma", value: "diploma" },
      { label: "Graduate / Bachelor's", value: "bachelor" },
      { label: "Postgraduate / Master's", value: "master" },
      { label: "Doctorate", value: "doctorate" },
    ],
  },
  {
    param: "stream",
    label: "Discipline / Stream",
    iconName: "stream",
    options: [
      { label: "Engineering", value: "engineering" },
      { label: "Medical", value: "medical" },
      { label: "Computer / IT", value: "computer" },
      { label: "Law & Legal", value: "law" },
      { label: "Nursing", value: "nursing" },
      { label: "Teaching", value: "teaching" },
      { label: "Commerce / Finance", value: "commerce" },
    ],
  },
  {
    param: "sector",
    label: "Sector",
    iconName: "sector",
    options: SECTORS.map((s) => ({ label: s.label, value: s.value })),
  },
  {
    param: "state",
    label: "State / Location",
    iconName: "location",
    options: INDIAN_STATES.map((state) => ({ label: state, value: state })),
  },
];

export type JobLevel = NonNullable<JobListOptions["level"]>;
export type JobStream = NonNullable<JobListOptions["stream"]>;

/**
 * A URL value, narrowed against allowed filter options.
 * Prevents invalid enum literals from reaching Postgres.
 */
export function optionOf(
  group: FilterGroup | undefined,
  value: string | undefined,
): string | undefined {
  if (!group || !value) return undefined;
  return group.options.some((o) => o.value === value) ? value : undefined;
}

/** The chip's label for a value, for the empty state line and active pills. */
export function labelOf(
  group: FilterGroup | undefined,
  value: string | undefined,
): string | undefined {
  return group?.options.find((o) => o.value === value)?.label;
}
