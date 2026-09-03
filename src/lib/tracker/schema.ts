import { z } from "zod";

/**
 * What the tracker's add form accepts.
 *
 * ── Why this is two fields ────────────────────────────────────────────────
 * It used to be ten: an exam picker, a free-text name, status, stage, three
 * dates, a roll number, a score and a notes box. Every one of them asked the
 * user for something the app already knows or is about to find out — the
 * notification carries its own dates and deadline, and the AI status report
 * (Module 19) is what fills in where the exam has actually got to. Asking for
 * them anyway meant a wall of empty inputs standing between "I want to track
 * SSC CGL" and a tracked exam, and the answers typed into it went stale the
 * moment the commission moved a date.
 *
 * So the form asks the one question only the user can answer — *which* exam —
 * and everything else is derived. Status still exists on the row; it defaults
 * to 'tracking' in the schema and is changed by the inline control on each
 * card, which is one tap rather than a round trip through a dialog.
 *
 * Mirrors `exam_attempts_has_subject`: a row must name a job this app knows or
 * carry free text. Enforcing that only in Postgres would surface as an opaque
 * constraint violation under the input.
 */

export const attemptSchema = z
  .object({
    /**
     * The notification the user picked from the suggestions.
     *
     * When this is set the row needs nothing else: `listExamAttempts` joins the
     * job for its title, closing date and application window, and the status
     * panel keys its AI report on `job:<id>`.
     */
    jobId: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .refine((v) => v === null || z.uuid().safeParse(v).success, {
        message: "Pick an exam from the suggestions, or type its name.",
      }),

    /**
     * What they typed, kept when it matched nothing.
     *
     * The suggestions only cover notifications this app has ingested, and
     * telling somebody their exam does not exist is absurd — a state exam we
     * have not scraped yet is still an exam they are sitting. The AI status
     * refresh works from the name alone.
     */
    customName: z
      .string()
      .trim()
      .max(160, "Keep this under 160 characters.")
      .transform((v) => (v === "" ? null : v))
      .nullable(),
  })
  .refine((v) => v.jobId !== null || v.customName !== null, {
    message: "Type an exam name, or pick one from the suggestions.",
    path: ["customName"],
  });

export type AttemptInput = z.infer<typeof attemptSchema>;
