/**
 * What the model read, turned into things that can be written to a profile.
 *
 * This module is the airlock. On one side is a JSON object a language model
 * produced from a photograph; on the other is somebody's stored date of birth.
 * Nothing crosses without being named here, and the review screen shows every
 * crossing to its owner before it happens.
 *
 * Three jobs, in order:
 *
 *   1. **Whitelist.** A key the model returns that is not in `FIELD_MAP` is
 *      dropped. Not "ignored later" — never offered. The old app spread the
 *      response over the profile with an allowlist defined as two arrays in a
 *      page component, which is the kind of list that grows a typo.
 *   2. **Coerce.** Dates arrive in four formats, percentages arrive as
 *      "78.5%", and gender arrives as "M". The database has enums and a date
 *      type; anything that will not fit is dropped rather than forced.
 *   3. **Explain.** Every accepted field carries the value it would replace, so
 *      the review screen can show "Ravi Kumar → Ravi Kumar Singh" rather than
 *      asking somebody to approve a change they cannot see.
 *
 * Pure. No database, no model, no network — which is what lets it be tested
 * against the actual malformed answers a photograph of a marksheet produces.
 */

export type FieldKind =
  "text" | "date" | "number" | "year" | "gender" | "category" | "qualification";

export interface FieldSpec {
  /** The profiles column, or an education column when `education` is set. */
  column: string;
  label: string;
  kind: FieldKind;
  /** Education fields go to `education_qualifications`, not `profiles`. */
  education?: boolean;
}

/**
 * Model key → destination.
 *
 * The keys on the left are the ones the prompts in `ai/prompts/ocr.ts` ask for,
 * spelled exactly as they ask for them — including `aadhar_number`, which is
 * the old project's spelling and therefore what the prompt says. The column on
 * the right is this schema's `aadhaar_number`. The mismatch is deliberate and
 * lives here, in one line, rather than being fixed by editing a prompt whose
 * behaviour is pinned.
 */
export const FIELD_MAP: Record<string, FieldSpec> = {
  full_name: { column: "full_name", label: "Full name", kind: "text" },
  father_name: { column: "father_name", label: "Father's name", kind: "text" },
  mother_name: { column: "mother_name", label: "Mother's name", kind: "text" },
  date_of_birth: { column: "date_of_birth", label: "Date of birth", kind: "date" },
  gender: { column: "gender", label: "Gender", kind: "gender" },
  address: { column: "address", label: "Address", kind: "text" },

  aadhar_number: { column: "aadhaar_number", label: "Aadhaar number", kind: "text" },
  pan_number: { column: "pan_number", label: "PAN", kind: "text" },
  passport_number: { column: "passport_number", label: "Passport number", kind: "text" },

  category: { column: "category", label: "Category", kind: "category" },
  sub_category: { column: "sub_category", label: "Sub-category", kind: "text" },
  caste_name: { column: "caste_name", label: "Caste", kind: "text" },
  caste_certificate_number: {
    column: "caste_certificate_number",
    label: "Caste certificate no.",
    kind: "text",
  },
  caste_issuing_authority: {
    column: "caste_issuing_authority",
    label: "Issuing authority",
    kind: "text",
  },
  caste_issue_date: { column: "caste_issue_date", label: "Certificate date", kind: "date" },
  ews_certificate_number: {
    column: "ews_certificate_number",
    label: "EWS certificate no.",
    kind: "text",
  },
  ews_issuing_authority: {
    column: "ews_issuing_authority",
    label: "EWS issuing authority",
    kind: "text",
  },
  disability_type: { column: "disability_type", label: "Disability type", kind: "text" },
  disability_certificate_number: {
    column: "disability_certificate_number",
    label: "Disability certificate no.",
    kind: "text",
  },

  // Education, which lands in a different table.
  board_university: {
    column: "board_university",
    label: "Board / University",
    kind: "text",
    education: true,
  },
  institute_name: {
    column: "institution",
    label: "Institution",
    kind: "text",
    education: true,
  },
  qualification_type: {
    column: "level",
    label: "Qualification",
    kind: "qualification",
    education: true,
  },
  qualification_name: {
    column: "discipline",
    label: "Discipline",
    kind: "text",
    education: true,
  },
  date_of_passing: {
    column: "year_of_passing",
    label: "Year of passing",
    kind: "year",
    education: true,
  },
  year_of_passing: {
    column: "year_of_passing",
    label: "Year of passing",
    kind: "year",
    education: true,
  },
  percentage: { column: "percentage", label: "Percentage", kind: "number", education: true },
};

/** The old app's qualification words, mapped onto this schema's enum. */
const QUALIFICATION_MAP: Record<string, string> = {
  "10th": "class_10",
  "12th": "class_12",
  iti: "iti",
  diploma: "diploma",
  graduation: "bachelor",
  bachelor: "bachelor",
  bachelors: "bachelor",
  post_graduation: "master",
  master: "master",
  masters: "master",
  phd: "doctorate",
  "ph.d": "doctorate",
  doctorate: "doctorate",
};

const CATEGORY_MAP: Record<string, string> = {
  general: "general",
  ur: "general",
  ews: "ews",
  obc: "obc",
  "obc-ncl": "obc_ncl",
  obc_ncl: "obc_ncl",
  sc: "sc",
  st: "st",
  pwd: "pwd",
  ph: "pwd",
};

export interface Suggestion {
  /** The model's key, for the review screen's identity. */
  key: string;
  column: string;
  label: string;
  /** Coerced, ready to write. */
  value: string | number;
  /** What is stored today, so the review shows a before and after. */
  current: string | null;
  education: boolean;
}

/**
 * Turn a model response into a reviewable list.
 *
 * `current` is passed in rather than fetched, so this stays pure and so the
 * caller controls which profile is being compared against.
 */
export function toSuggestions(
  raw: unknown,
  current: Record<string, string | null>,
): Suggestion[] {
  if (typeof raw !== "object" || raw === null) return [];

  const out: Suggestion[] = [];

  for (const [key, rawValue] of Object.entries(raw as Record<string, unknown>)) {
    const spec = FIELD_MAP[key];
    // Not on the list: never offered. This is the whitelist, and it is the
    // reason a model inventing `"salary": "50000"` cannot reach a profile.
    if (!spec) continue;

    const value = coerce(rawValue, spec.kind);
    if (value === null) continue;

    const currentValue = current[spec.column] ?? null;

    // Nothing to review if it already says that.
    if (currentValue !== null && currentValue === String(value)) continue;

    out.push({
      key,
      column: spec.column,
      label: spec.label,
      value,
      current: currentValue,
      education: spec.education ?? false,
    });
  }

  return out;
}

function coerce(raw: unknown, kind: FieldKind): string | number | null {
  if (raw === null || raw === undefined) return null;

  // Narrowed to primitives before stringifying. A model that returns an object
  // or an array for a field — `{"full_name": {"first": "Ravi"}}` — would
  // otherwise become the literal text "[object Object]" and be offered as
  // somebody's name.
  let text: string;
  if (typeof raw === "string") text = raw.trim();
  else if (typeof raw === "number" || typeof raw === "boolean") text = String(raw).trim();
  else return null;

  // Models return these three strings for "I could not read it" often enough
  // that treating them as values would put the word "null" in somebody's name.
  if (text === "" || /^(null|n\/a|na|none|not found|-)$/i.test(text)) return null;

  switch (kind) {
    case "text":
      // A 500-character "address" is the model having transcribed the whole
      // document into one field. Offering it would be worse than dropping it.
      return text.length <= 300 ? text : null;

    case "number": {
      // "78.5%" and "78.5 %" both mean 78.5.
      const n = Number.parseFloat(text.replace(/[%\s]/g, ""));
      if (!Number.isFinite(n) || n < 0 || n > 100) return null;
      return n;
    }

    case "date":
      return toIsoDate(text);

    case "year": {
      const iso = toIsoDate(text);
      if (iso) {
        const yr = Number(iso.slice(0, 4));
        if (Number.isFinite(yr) && yr >= 1950 && yr <= 2100) return yr;
      }
      const match = /(19|20)\d{2}/.exec(text);
      if (match) {
        const yr = Number(match[0]);
        if (yr >= 1950 && yr <= 2100) return yr;
      }
      return null;
    }

    case "gender": {
      const g = text.toLowerCase();
      if (g.startsWith("m")) return "male";
      if (g.startsWith("f")) return "female";
      return null;
    }

    case "category": {
      const c = text.toLowerCase().replace(/\s+/g, "");
      return CATEGORY_MAP[c] ?? null;
    }

    case "qualification": {
      const q = text.toLowerCase().replace(/\s+/g, "_");
      return QUALIFICATION_MAP[q] ?? null;
    }
  }
}

/**
 * The four date formats an Indian certificate actually uses.
 *
 * `new Date(string)` is not usable here: it reads "01/02/2003" as 1 February in
 * some engines and 2 January in others, and on a date of birth that is an
 * eleven-month error in somebody's age. Everything is parsed explicitly, and
 * anything ambiguous beyond the day-first convention is dropped.
 */
export function toIsoDate(input: string): string | null {
  const text = input.trim();

  // Already ISO.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return valid(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY — day first, which is the
  // convention on every Indian document.
  const dmy = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(text);
  if (dmy) return valid(Number(dmy[3]), Number(dmy[2]), Number(dmy[1]));

  // "15 August 2003" / "15 Aug 2003"
  const named = /^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/.exec(text);
  if (named) {
    const month = MONTHS.indexOf((named[2] ?? "").slice(0, 3).toLowerCase()) + 1;
    if (month > 0) return valid(Number(named[3]), month, Number(named[1]));
  }

  // A bare year, which marksheets often give for year of passing. Anchored to
  // 1 January and only accepted where a year alone is meaningful.
  const year = /^(19|20)\d{2}$/.exec(text);
  if (year) return valid(Number(text), 1, 1);

  return null;
}

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

function valid(year: number, month: number, day: number): string | null {
  if (year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  // Rejects 31 February rather than letting Date roll it into March.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
