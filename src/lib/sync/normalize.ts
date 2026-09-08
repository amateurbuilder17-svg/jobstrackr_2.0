/**
 * The parser. One of them.
 *
 * The old pipeline kept this logic in two places — `apps-script/Html.gs` and
 * `api/lib/scraper_v5.py` — and kept them in step by hand. Every recurring
 * scraper bug traced back to the two drifting apart: a pay-matrix level read as
 * a salary in one and not the other, a stipend column summed as vacancies. This
 * module is the single source of truth the plan asks for, and it is pure
 * functions over unknown input so it can be tested exhaustively without a
 * network or a database.
 *
 * Every function takes `unknown`, because the input is a spreadsheet cell that
 * a person can type anything into.
 */

import { MAX_PLAUSIBLE_SALARY, MIN_PLAUSIBLE_SALARY } from "@/lib/format/salary";
import { decodeEntities } from "@/lib/format/text";

/** Asia/Kolkata is UTC+5:30. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/**
 * What the scrapers write when they have nothing.
 *
 * `Config.gs` is explicit about this — `NA_TEXT: 'Not Available'` and
 * `NA_DATE: 'TBD'` — and the comment beside it says why: never fabricate a
 * plausible value. That is the right call at the scraper, and it makes these
 * strings markers rather than content. Read literally they become a job whose
 * location is "Not Available" and whose vacancy count reads "Not Available"
 * on the card, which is worse than an empty field because it looks deliberate.
 *
 * "TBD" is deliberately NOT on this list, and the test that pins it says why:
 * `last_date_display` exists so the sheet can say "TBD" without the parser
 * inventing a date, and the badge renders it as the answer. `toDate` already
 * rejects it by shape, so it never reaches a date column either way.
 * "Not Available" is different — it is the absence of an answer, not one.
 *
 * Otherwise this is the list `jobs/detail-shape.ts` has always applied to the
 * JSONB side, applied now to the typed columns as well.
 *
 * "Not Found" is the newest entry and the costliest omission: it is the marker
 * the detail scraper writes, and it reached `vacancies_display` on 551 of the
 * 2,601 published rows, every one of which printed those two words on the card
 * where a vacancy count belongs.
 */
const PLACEHOLDER =
  /^(n\.?\s*\/?\s*a\.?|na|nil|none|null|undefined|not\s*available|not\s*found|not\s*specified|not\s*mentioned|-+|—+)$/i;

/**
 * Text from a spreadsheet cell, or null.
 *
 * Objects and arrays return null rather than being coerced. `String({})` is
 * "[object Object]", and a cell that arrived as an object — a JSON column read
 * into the wrong field, say — would otherwise be stored as that literal string
 * and look like real data forever.
 */
function cellText(value: unknown): string | null {
  // Narrowed to the types that can be stringified meaningfully, rather than
  // excluding objects and hoping. `String(Symbol())` throws outright, and a
  // function would serialise its own source into a database column.
  let text: string;
  if (typeof value === "string") text = value;
  else if (typeof value === "number" || typeof value === "boolean") text = String(value);
  else if (typeof value === "bigint") text = value.toString();
  else return null;

  // Decoded here, at the boundary, so what lands in the database is text
  // rather than someone else's markup. See `format/text.ts` for why the
  // renderer decodes as well.
  const trimmed = decodeEntities(text).trim();
  if (trimmed === "" || PLACEHOLDER.test(trimmed)) return null;
  return trimmed;
}

/**
 * A date cell, as a plain `YYYY-MM-DD` calendar date.
 *
 * The subtle case, and the one that caused real wrong dates: Apps Script
 * serialises a Sheet date cell in Asia/Kolkata as a UTC instant, so midnight IST
 * on the 30th arrives as `2026-06-29T18:30:00.000Z` — the *29th* if you take
 * the first ten characters, which is what a naive `.slice(0, 10)` does. Adding
 * the IST offset before slicing recovers the day the person actually typed.
 *
 * Anything that is not a full ISO datetime passes through untouched. "TBD",
 * "30 Jun 2026" and "" are all things a human puts in that column, and mangling
 * them would be worse than leaving them alone — `last_date_display` exists to
 * carry exactly that.
 */
export function toDateText(value: unknown): string | null {
  const text = cellText(value);
  if (text === null) return null;
  if (!ISO_DATETIME.test(text)) return text;

  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return text;

  return new Date(parsed.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** A date column that must be a real date or null — no free text. */
export function toDate(value: unknown): string | null {
  const text = toDateText(value);
  if (text === null) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function toNum(value: unknown): number | null {
  const text = cellText(value);
  if (text === null) return null;
  // Strips ₹, commas and spaces: "₹1,42,400" is a normal thing to find in this
  // column. `Number("")` is 0, which is why the empty check comes first.
  const cleaned = text.replace(/[₹,\s]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * The widest value a PostgreSQL `integer` column can hold.
 *
 * Every numeric column ingestion writes is `integer` or narrower, and PostgREST
 * does not clamp — it hands the value to Postgres, which raises "value … is out
 * of range for type integer". That error is thrown, so it does not cost the one
 * bad row: it costs the whole batch. 85 runs died on it between 2026-08-26 and
 * 2026-09-03, every one of them on a fee.
 *
 * The values are not near-misses. `application_fee` arrives from the scraper as
 * "50100079546912" — a fee table's every figure run together upstream, before
 * this module sees it. Nothing that large is a number a person typed, so the
 * only question is whether it becomes NULL here or an exception there.
 */
const PG_INT_MAX = 2_147_483_647;

/**
 * An integer column. Fractions are a parse error, not something to round.
 *
 * The range check is a floor, not a substitute for knowing the column: `age_min`
 * and friends are `smallint`, and the callers below carry the bounds that
 * actually fit them. This one only guarantees that no parse artefact, from any
 * column, can reach the database as an exception.
 */
export function toInt(value: unknown): number | null {
  const n = toNum(value);
  if (n === null) return null;
  if (!Number.isInteger(n) || Math.abs(n) > PG_INT_MAX) return null;
  return n;
}

export function toBool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  const raw = cellText(value);
  if (raw === null) return fallback;
  const text = raw.toLowerCase();
  if (["true", "yes", "y", "1"].includes(text)) return true;
  if (["false", "no", "n", "0"].includes(text)) return false;
  return fallback;
}

export function toText(value: unknown): string | null {
  return cellText(value);
}

export function toJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  // An object is already parsed — the feed sends these either way.
  if (typeof value === "object") return value as T;

  const text = cellText(value);
  if (text === null) return fallback;

  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** A text[] column, from an array, a JSON-array cell, or a comma-separated one. */
export function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => cellText(v) ?? "").filter(Boolean);
  }
  const text = cellText(value);
  if (text === null) return [];

  // A cell holding a JSON array, which is what a script that builds one in
  // memory and writes it without joining leaves behind. Comma-splitting that
  // produces `["[]"]` for an empty array — a badge reading "[]", which is what
  // 5,978 exam_updates rows carried — and `['["a"', '"b"]']` for a full one.
  // Handled here rather than at a call site, because any cell this function
  // reads can arrive in that shape.
  if (text.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map((v) => cellText(v) ?? "").filter(Boolean);
    } catch {
      // Not JSON after all — fall through to the comma split.
    }
  }

  return text
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

/**
 * The lowest number that can plausibly be a monthly salary in rupees.
 *
 * Government notifications print pay in two registers — "₹35,400 – ₹1,12,400"
 * and "Pay Matrix Level 7" — and the scrapers put both in the same column. A
 * level read as a salary shows a job paying ₹7 a month, which is what the old
 * app rendered until the renderer learned to second-guess its own data.
 *
 * Defined in `format/salary.ts` and re-exported here, because the renderer
 * applies the same threshold to the rows already in the table and the two must
 * not drift — that drift is what the old two-parser pipeline kept producing.
 *
 * The upper bound came from exactly that drift: `format/salary.ts` has enforced
 * `MAX_PLAUSIBLE_SALARY` on the read side since it was written, and `toSalary`
 * checked only the floor. A yearly CTC in a monthly column was rejected on the
 * page and stored in the table.
 */
export { MAX_PLAUSIBLE_SALARY, MIN_PLAUSIBLE_SALARY } from "@/lib/format/salary";

/**
 * A salary column, or null.
 *
 * Each end is judged on its own: a level in one column must not poison a
 * genuine figure in the other, which happens when a notification writes
 * "Level 7 – ₹1,12,400".
 */
export function toSalary(value: unknown): number | null {
  const n = toInt(value);
  if (n === null || n < MIN_PLAUSIBLE_SALARY || n > MAX_PLAUSIBLE_SALARY) return null;
  return n;
}

/**
 * The most an application fee can plausibly be, in rupees.
 *
 * General-category fees in these notifications run from nothing to about three
 * thousand; a lakh is far above the highest real one and far below the smallest
 * artefact this has ever seen (ten billion). The failure it catches is the fee
 * *table* — "Gen ₹1000, OBC ₹500, SC/ST ₹0" — arriving as one welded number.
 */
export const MAX_PLAUSIBLE_FEE = 100_000;

export function toFee(value: unknown): number | null {
  const n = toInt(value);
  if (n === null || n < 0 || n > MAX_PLAUSIBLE_FEE) return null;
  return n;
}

/**
 * The oldest a recruitment age limit can plausibly be.
 *
 * `age_min` and `age_max` are `smallint`, so the ceiling that matters is much
 * lower than `PG_INT_MAX` — 32,768 in an age column is still an exception, and
 * still takes the batch with it. No notification sets a limit above 120, and
 * anything that reads as one is a row of a table read as a single figure.
 */
export const MAX_PLAUSIBLE_AGE = 120;

export function toAge(value: unknown): number | null {
  const n = toInt(value);
  if (n === null || n < 0 || n > MAX_PLAUSIBLE_AGE) return null;
  return n;
}

/**
 * The most years of experience a posting can plausibly demand. Also `smallint`,
 * and a working life is shorter than this.
 */
export const MAX_PLAUSIBLE_EXPERIENCE_YEARS = 60;

export function toExperienceYears(value: unknown): number | null {
  const n = toInt(value);
  if (n === null || n < 0 || n > MAX_PLAUSIBLE_EXPERIENCE_YEARS) return null;
  return n;
}

/**
 * The largest vacancy count worth believing.
 *
 * The other half of the same trap: a stipend column read as vacancies, or a
 * table whose amounts were summed. India's largest single recruitment
 * notification in recent years was about 150,000 posts, so anything above a
 * million is a parse artefact rather than a record-breaking drive.
 */
export const MAX_PLAUSIBLE_VACANCIES = 1_000_000;

export function toVacancies(value: unknown): number | null {
  const n = toInt(value);
  if (n === null || n < 0 || n > MAX_PLAUSIBLE_VACANCIES) return null;
  return n;
}

export const EMBEDDING_DIMS = 384;

/**
 * An embedding, or null.
 *
 * Rejects anything that is not exactly 384 finite numbers. PostgREST would
 * accept a short or garbled vector without complaint and it would only surface
 * much later as similarity search quietly returning nonsense — so a bad value
 * must become NULL and let the embedding pass regenerate it. Silence here is
 * the expensive option.
 */
export function toVector(value: unknown): number[] | null {
  if (value === "" || value === null || value === undefined) return null;

  let raw: unknown = value;
  if (!Array.isArray(raw)) {
    const text = cellText(value);
    if (text === null) return null;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
  }

  if (!Array.isArray(raw) || raw.length !== EMBEDDING_DIMS) return null;

  const numbers = raw.map(Number);
  return numbers.every((n) => Number.isFinite(n)) ? numbers : null;
}

/**
 * Deterministic title → slug.
 *
 * Mirrors the `generate_job_slug` behaviour the old schema had, so a slug can
 * be computed before insert and the deep link is known in advance. Collision
 * suffixes are the caller's job — this returns the base only.
 */
export function toSlug(title: unknown): string {
  const base = (cellText(title) ?? "")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/^-+|-+$/g, "");

  return base.length > 80 ? base.slice(0, 80).replace(/-+$/g, "") : base;
}
