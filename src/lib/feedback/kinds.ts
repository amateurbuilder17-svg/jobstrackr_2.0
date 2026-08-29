/**
 * The two kinds of feedback, and the limit on a message.
 *
 * Deliberately a separate module from `schema.ts`, and the separation is
 * measured rather than stylistic — it is the same trap `profile/enums.ts`
 * documents. The schema builds its `z.object(...)` at module scope, which a
 * bundler cannot treat as side-effect-free, so the form importing one label
 * constant from there pulled the whole of Zod into the browser bundle and put
 * /feedback at 219 kB against a 158 kB budget.
 *
 * Nothing in this file imports anything. The form imports from here; `schema.ts`
 * imports from here too, so the two cannot drift.
 */

export const FEEDBACK_KINDS = ["suggestion", "grievance"] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_LABELS: Record<FeedbackKind, { label: string; hint: string }> = {
  suggestion: {
    label: "Suggestion",
    hint: "Something that would make JobsTrackr better",
  },
  grievance: {
    label: "Grievance",
    hint: "Something wrong, broken, or missing",
  },
};

/**
 * Matches the database's own `suggestions_message_length` check.
 *
 * Two limits that disagree produce the worst possible failure — a form that
 * accepts what the table then rejects, and a person who wrote a long complaint
 * watching it disappear.
 */
export const MESSAGE_MAX = 2000;
