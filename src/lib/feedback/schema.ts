import { z } from "zod";

import { FEEDBACK_KINDS, MESSAGE_MAX } from "./kinds";

/**
 * What the feedback form accepts.
 *
 * Server-side only, and it must stay that way — see `kinds.ts` for why. The
 * constants live there precisely so a Client Component never has a reason to
 * import this module.
 */
export const feedbackSchema = z
  .object({
    kind: z.enum(FEEDBACK_KINDS),
    // Checkbox semantics: present means on, absent means off.
    anonymous: z.coerce.boolean().default(false),
    email: z.union([z.literal(""), z.email("That does not look like an email address.")]),
    message: z
      .string()
      .trim()
      .min(1, "Write a message first.")
      .max(MESSAGE_MAX, `Keep it under ${String(MESSAGE_MAX)} characters.`),
  })
  .refine((value) => value.anonymous || value.email !== "", {
    // An address is how a reply reaches them. Anonymous is the deliberate
    // choice to give that up, and the form says so; a blank address without
    // that choice is an oversight worth catching.
    path: ["email"],
    message: "Add an email address, or send this anonymously.",
  });

export type FeedbackInput = z.infer<typeof feedbackSchema>;
