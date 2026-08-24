import { z } from "zod";

import { ATTEMPT_STATUSES } from "./enums";

/**
 * What the tracker form accepts.
 *
 * Mirrors `exam_attempts_has_subject` and `exam_attempts_status_known` from the
 * migrations. The subject rule is the interesting one: a row must name an exam
 * this app knows, or carry free text, and enforcing that only in Postgres would
 * surface as an opaque constraint violation in the form.
 */

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${String(max)} characters.`)
    .transform((v) => (v === "" ? null : v))
    .nullable();

const optionalDate = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .refine((v) => v === null || !Number.isNaN(Date.parse(v)), {
    message: "Enter a valid date.",
  });

export const attemptSchema = z
  .object({
    examId: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .refine((v) => v === null || z.uuid().safeParse(v).success, {
        message: "Pick an exam from the list.",
      }),

    customName: optional(160),
    stage: optional(80),
    status: z.enum(ATTEMPT_STATUSES),

    appliedAt: optionalDate,
    examDate: optionalDate,
    resultDate: optionalDate,

    rollNumber: optional(60),

    score: z
      .union([z.string(), z.number()])
      .transform((v) => (v === "" ? null : Number(v)))
      .nullable()
      .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 999999), {
        message: "Enter a number.",
      }),

    notes: optional(2000),
  })
  .refine((v) => v.examId !== null || v.customName !== null, {
    // Without a subject the row means nothing, and the database refuses it.
    // Reported on `customName` because that is the field someone can always
    // fill in — the exam list may simply not contain what they are sitting.
    message: "Choose an exam, or type its name.",
    path: ["customName"],
  });

export type AttemptInput = z.infer<typeof attemptSchema>;
