/**
 * Enum values and their labels, mirrored from the database.
 *
 * Deliberately a separate module from `auth/schemas.ts`, and the separation is
 * measured rather than stylistic. The schemas build their `z.object(...)` at
 * module scope, which a bundler cannot treat as side-effect-free — so a Client
 * Component importing one label constant from there pulls the whole of Zod into
 * the browser bundle. That put /profile at 213 kB against a 155 kB budget.
 *
 * Nothing in this file imports anything. Client Components import from here;
 * `schemas.ts` imports from here too, so the two cannot drift.
 */

export const GENDERS = ["any", "male", "female"] as const;

export const QUALIFICATION_LEVELS = [
  "class_10",
  "class_12",
  "iti",
  "diploma",
  "bachelor",
  "master",
  "doctorate",
] as const;

export const RESERVATION_CATEGORIES = [
  "general",
  "ews",
  "obc",
  "obc_ncl",
  "sc",
  "st",
  "pwd",
] as const;

/** Human labels, so a select and a summary line cannot disagree. */
export const QUALIFICATION_LABELS: Record<(typeof QUALIFICATION_LEVELS)[number], string> = {
  class_10: "Class 10",
  class_12: "Class 12",
  iti: "ITI",
  diploma: "Diploma",
  bachelor: "Bachelor's degree",
  master: "Master's degree",
  doctorate: "Doctorate",
};

export const CATEGORY_LABELS: Record<(typeof RESERVATION_CATEGORIES)[number], string> = {
  general: "General",
  ews: "EWS",
  obc: "OBC",
  obc_ncl: "OBC (non-creamy layer)",
  sc: "SC",
  st: "ST",
  pwd: "PwD",
};
