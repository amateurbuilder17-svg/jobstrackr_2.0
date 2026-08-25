import { z } from "zod";

import { GENDERS, QUALIFICATION_LEVELS, RESERVATION_CATEGORIES } from "@/lib/profile/enums";

// Re-exported so server-side callers have one import for "the contract".
// Client Components must import these from `@/lib/profile/enums` directly —
// reaching them through this module pulls Zod into the browser bundle.
export {
  CATEGORY_LABELS,
  GENDERS,
  QUALIFICATION_LABELS,
  QUALIFICATION_LEVELS,
  RESERVATION_CATEGORIES,
} from "@/lib/profile/enums";

/**
 * The validation contract, imported by both the form and the server action.
 *
 * One schema, two callers, is the entire point. A form that validates with
 * different rules than the action behind it produces the worst class of bug in
 * this app: the client says the value is fine, the server disagrees, and the
 * user is told "something went wrong" with no way to find out what. Every rule
 * below is also a CHECK constraint in the migrations, so the database is the
 * third and final agreement — see `profiles_dob_sane`, `education_year_sane`.
 *
 * These schemas are safe to import from Client Components. They deliberately
 * contain no secrets, no database handles and no `server-only` imports.
 */

/* ── Shared field helpers ──────────────────────────────────────────────── */

/**
 * An untouched HTML input submits `""`, not `undefined`. Treating that as a
 * real value writes empty strings into nullable columns, and `""` and `null`
 * then mean the same thing to a person and different things to a query. Every
 * optional text field is normalised to `null` here, once.
 */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${String(max)} characters.`)
    .transform((v) => (v === "" ? null : v))
    .nullable();

/**
 * Normalise first, then validate.
 *
 * Order is load-bearing: `z.email().trim()` checks the format *before* the trim
 * runs, so an address pasted with a trailing space — which is what autofill and
 * copy-paste routinely produce — is rejected as malformed. Piping the cleaned
 * string into the format check is what makes " Asha@Example.COM " the same
 * account as "asha@example.com".
 */
const email = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address."));

/**
 * Eight characters, and no composition rules.
 *
 * Length is the property that actually resists guessing; forced symbol classes
 * mostly produce `Password1!` and a sticky note. Supabase enforces its own
 * floor server-side, so this is the friendlier of the two limits, not the only
 * one.
 */
const password = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(72, "Passwords are limited to 72 characters.");

/* ── Auth ──────────────────────────────────────────────────────────────── */

export const signInSchema = z.object({
  email,
  // No length rule on sign-in. The floor applies to passwords being created;
  // applying it here would tell an attacker that a short guess was "invalid"
  // rather than simply wrong, and would lock out anyone whose existing password
  // predates the rule.
  password: z.string().min(1, "Enter your password."),
});

export const signUpSchema = z.object({
  email,
  password,
  fullName: z
    .string()
    .trim()
    .min(2, "Enter your name.")
    .max(120, "Keep this under 120 characters."),
});

export const requestPasswordResetSchema = z.object({ email });

export const updatePasswordSchema = z
  .object({
    password,
    confirmPassword: z.string(),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "The two passwords do not match.",
    path: ["confirmPassword"],
  });

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;

/* ── Profile ───────────────────────────────────────────────────────────── */

const DOB_FLOOR = "1940-01-01";

export const profileSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Enter your name.")
    .max(120, "Keep this under 120 characters."),

  phone: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .refine((v) => v === null || /^[6-9]\d{9}$/.test(v), {
      // Indian mobile numbers only, because this is what every downstream
      // consumer assumes — Telegram linking in M12 included. Ten digits, first
      // digit 6-9. Rejecting a landline here is intentional.
      message: "Enter a 10-digit Indian mobile number.",
    }),

  /**
   * Date of birth rather than age, matching the column. The upper bound is
   * "today" evaluated per validation rather than at module load — a schema
   * built once at boot and reused for months would otherwise drift.
   */
  dateOfBirth: z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .refine((v) => v === null || !Number.isNaN(Date.parse(v)), {
      message: "Enter a valid date.",
    })
    .refine((v) => v === null || (v >= DOB_FLOOR && v <= today()), {
      message: "That date of birth is out of range.",
    }),

  gender: z.enum(GENDERS).nullable().catch(null),
  category: z.enum(RESERVATION_CATEGORIES).nullable().catch(null),

  state: optionalText(80),
  district: optionalText(80),

  highestQualification: z.enum(QUALIFICATION_LEVELS).nullable().catch(null),

  experienceYears: z
    .union([z.string(), z.number()])
    .transform((v) => (v === "" ? null : Number(v)))
    .nullable()
    .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 60), {
      message: "Enter whole years between 0 and 60.",
    }),

  // Multi-selects arrive as repeated form fields; `getAll` gives an array even
  // for one value, and an absent field gives `[]`, which is the column default.
  preferredSectors: z.array(z.string().trim().min(1)).max(20).default([]),
  preferredStates: z.array(z.string().trim().min(1)).max(40).default([]),
});

export type ProfileInput = z.infer<typeof profileSchema>;

/* ── Education ─────────────────────────────────────────────────────────── */

export const educationSchema = z.object({
  level: z.enum(QUALIFICATION_LEVELS),
  discipline: optionalText(120),
  institution: optionalText(160),
  boardUniversity: optionalText(160),

  yearOfPassing: z
    .union([z.string(), z.number()])
    .transform((v) => (v === "" ? null : Number(v)))
    .nullable()
    .refine(
      (v) =>
        v === null || (Number.isInteger(v) && v >= 1950 && v <= new Date().getFullYear() + 6),
      {
        // The +6 upper bound mirrors `education_year_sane`: someone in the first
        // year of a five-year integrated course has a real future passing year.
        message: "Enter a year between 1950 and six years from now.",
      },
    ),

  percentage: z
    .union([z.string(), z.number()])
    .transform((v) => (v === "" ? null : Number(v)))
    .nullable()
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v <= 100), {
      message: "Enter a percentage between 0 and 100.",
    }),
});

export type EducationInput = z.infer<typeof educationSchema>;

/* ── The matcher's minimum ─────────────────────────────────────────────── */

/**
 * The three fields `match_jobs` cannot work without, as one small form.
 *
 * Deliberately stricter than `profileSchema`, which allows every field to be
 * null because a half-finished profile is a legitimate state. Here a null is
 * the whole problem: the feed this form appears above is empty precisely
 * because one of these is missing, so accepting a blank would be accepting a
 * submission that changes nothing.
 *
 * `discipline` stays optional, and that is not an inconsistency. Without it the
 * matcher still works — it just only matches postings open to any discipline,
 * which is an honest partial answer rather than a broken one.
 */
export const matchProfileSchema = z.object({
  dateOfBirth: z
    .string()
    .trim()
    .min(1, "Enter your date of birth — every notification states an age limit.")
    .refine((v) => !Number.isNaN(Date.parse(v)), { message: "Enter a valid date." })
    .refine((v) => v >= DOB_FLOOR && v <= today(), {
      message: "That date of birth is out of range.",
    }),

  highestQualification: z
    .enum(QUALIFICATION_LEVELS, "Choose your highest qualification.")
    .nullable()
    .refine((v): v is (typeof QUALIFICATION_LEVELS)[number] => v !== null, {
      message: "Choose your highest qualification.",
    }),

  discipline: optionalText(120),
});

export type MatchProfileInput = z.infer<typeof matchProfileSchema>;

/* ── Helpers ───────────────────────────────────────────────────────────── */

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Flattens a ZodError into `{ field: message }`, keeping the first message per
 * field. Server actions return this shape and forms read it directly, so the
 * error rendering path is identical whichever side caught the problem.
 */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    out[key] ??= issue.message;
  }
  return out;
}
