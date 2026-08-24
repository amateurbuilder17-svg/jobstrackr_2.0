/**
 * Tracker vocabulary.
 *
 * Zero imports, for the same measured reason as `profile/enums.ts`: a Client
 * Component that reaches these through a module containing `z.object(...)` at
 * top level pulls all of Zod into the browser bundle.
 *
 * The values mirror `exam_attempts_status_known` in the migrations. Adding one
 * here without the constraint produces a row the database rejects; the reverse
 * produces a status nothing can display.
 */

export const ATTEMPT_STATUSES = [
  "tracking",
  "applied",
  "admit_card",
  "appeared",
  "passed",
  "failed",
  "withdrawn",
] as const;

export type AttemptStatus = (typeof ATTEMPT_STATUSES)[number];

export const STATUS_LABELS: Record<AttemptStatus, string> = {
  tracking: "Tracking",
  applied: "Applied",
  admit_card: "Admit card out",
  appeared: "Appeared",
  passed: "Passed",
  failed: "Not selected",
  withdrawn: "Withdrawn",
};

/**
 * Badge tone per status, so the list scans by colour before it is read.
 * "Not selected" is deliberately neutral rather than red — it is a normal
 * outcome of applying for government jobs, not an error state to be scolded
 * about.
 */
export const STATUS_TONE: Record<AttemptStatus, "neutral" | "accent" | "warn" | "good"> = {
  tracking: "neutral",
  applied: "accent",
  admit_card: "warn",
  appeared: "accent",
  passed: "good",
  failed: "neutral",
  withdrawn: "neutral",
};

/** The order the list groups by: live things first, finished things last. */
export const STATUS_ORDER: Record<AttemptStatus, number> = {
  admit_card: 0,
  applied: 1,
  tracking: 2,
  appeared: 3,
  passed: 4,
  failed: 5,
  withdrawn: 6,
};
