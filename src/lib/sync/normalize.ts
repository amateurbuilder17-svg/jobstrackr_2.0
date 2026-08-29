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
 */
const PLACEHOLDER =
  /^(n\.?\s*\/?\s*a\.?|na|nil|none|null|undefined|not\s*available|not\s*specified|not\s*mentioned|-+|—+)$/i;

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

/** An integer column. Fractions are a parse error, not something to round. */
export function toInt(value: unknown): number | null {
  const n = toNum(value);
  if (n === null) return null;
  return Number.isInteger(n) ? n : null;
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

/** A text[] column, from either an array or a comma-separated cell. */
export function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => cellText(v) ?? "").filter(Boolean);
  }
  const text = cellText(value);
  if (text === null) return [];
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
 * 1,000 is deliberately far below any real government salary and far above any
 * pay-matrix level or grade-pay band, so nothing genuine is discarded to catch
 * them.
 */
export const MIN_PLAUSIBLE_SALARY = 1_000;

/**
 * A salary column, or null.
 *
 * Each end is judged on its own: a level in one column must not poison a
 * genuine figure in the other, which happens when a notification writes
 * "Level 7 – ₹1,12,400".
 */
export function toSalary(value: unknown): number | null {
  const n = toInt(value);
  if (n === null || n < MIN_PLAUSIBLE_SALARY) return null;
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
