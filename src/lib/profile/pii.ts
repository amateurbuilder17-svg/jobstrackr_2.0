/**
 * The fields a government application form asks for, and how to talk about
 * them.
 *
 * Deliberately its own module rather than an addition to `columns.ts`. Two
 * reasons, and the second is the important one:
 *
 *   1. `PROFILE_COLUMNS` is the general profile read, used by the profile page
 *      and by matching. None of this belongs in it — a page that renders your
 *      preferred sectors has no business also selecting your caste certificate
 *      number.
 *   2. Selecting less is the security property. The masked identity columns are
 *      here, the encrypted ones are named nowhere in the application at all,
 *      and the only route to a real number is `decrypt_own_id` — one field, one
 *      call, for the caller themselves.
 *
 * Nothing here imports anything. It is consumed by a Client Component, and the
 * `enums.ts` note applies: importing a label constant from a module with Zod
 * behind it drags Zod into the browser bundle.
 */

/**
 * What the copy page reads. Masked identity columns only — never the ciphertext.
 *
 * One unbroken literal, not a concatenation, and not an array joined at
 * runtime. Supabase infers the row type from this exact string; anything the
 * compiler cannot read as a literal collapses the result to `any`, which is the
 * same reason `PROFILE_COLUMNS` is written out longhand.
 */
export const PII_COLUMNS =
  "full_name, father_name, mother_name, date_of_birth, gender, phone, address, pincode, state, district, marital_status, current_status, category, sub_category, caste_name, caste_certificate_number, caste_issuing_authority, caste_issue_date, ews_certificate_number, ews_issuing_authority, disability_type, disability_certificate_number, aadhaar_number, pan_number, passport_number" as const;

/** The three fields whose real value lives only in an encrypted column. */
export const SECRET_FIELDS = ["aadhaar", "pan", "passport"] as const;

export type SecretField = (typeof SECRET_FIELDS)[number];

export const SECRET_LABELS: Record<SecretField, string> = {
  aadhaar: "Aadhaar number",
  pan: "PAN",
  passport: "Passport number",
};

/**
 * How the form groups them.
 *
 * The order is the order forms ask in — personal, then contact, then category,
 * then documents — because the page is used while another tab is open on an
 * application, and matching that order is what makes it faster than scrolling.
 */
export interface PiiField {
  key: string;
  label: string;
  /** Present when the value is only readable through `decrypt_own_id`. */
  secret?: SecretField;
  /** Rendered as a date rather than a raw ISO string. */
  isDate?: boolean;
}

export interface PiiGroup {
  title: string;
  hint?: string;
  fields: PiiField[];
}

export const PII_GROUPS: PiiGroup[] = [
  {
    title: "Personal",
    fields: [
      { key: "full_name", label: "Full name" },
      { key: "father_name", label: "Father's name" },
      { key: "mother_name", label: "Mother's name" },
      { key: "date_of_birth", label: "Date of birth", isDate: true },
      { key: "gender", label: "Gender" },
      { key: "marital_status", label: "Marital status" },
      { key: "current_status", label: "Current status" },
    ],
  },
  {
    title: "Contact",
    fields: [
      { key: "phone", label: "Phone" },
      { key: "address", label: "Address" },
      { key: "state", label: "State" },
      { key: "district", label: "District" },
      { key: "pincode", label: "PIN code" },
    ],
  },
  {
    title: "Category",
    hint: "What most forms call reservation details.",
    fields: [
      { key: "category", label: "Category" },
      { key: "sub_category", label: "Sub-category" },
      { key: "caste_name", label: "Caste" },
      { key: "caste_certificate_number", label: "Caste certificate no." },
      { key: "caste_issuing_authority", label: "Issuing authority" },
      { key: "caste_issue_date", label: "Certificate date", isDate: true },
      { key: "ews_certificate_number", label: "EWS certificate no." },
      { key: "ews_issuing_authority", label: "EWS issuing authority" },
      { key: "disability_type", label: "Disability type" },
      { key: "disability_certificate_number", label: "Disability certificate no." },
    ],
  },
  {
    title: "Identity documents",
    hint: "Shown masked. Copying fetches the full number for that one field.",
    fields: [
      { key: "aadhaar_number", label: "Aadhaar number", secret: "aadhaar" },
      { key: "pan_number", label: "PAN", secret: "pan" },
      { key: "passport_number", label: "Passport number", secret: "passport" },
    ],
  },
];

/** Whether a stored value is a mask rather than a real one. */
export function isMasked(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith("****");
}
