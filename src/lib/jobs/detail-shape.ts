/* eslint-disable @typescript-eslint/consistent-type-definitions --
   Type aliases, not interfaces, and the difference is load-bearing here: an
   interface has no implicit index signature, so `ImportantDate[]` is not
   assignable to the generated `Json` type and every write to a jsonb column
   would need a cast through `unknown`. A cast is how a shape stops being
   checked at all, which is precisely what these types exist to prevent. */

/**
 * The shapes the detail page renders, and the parsers that produce them.
 *
 * These columns are `jsonb`, which means the database will accept literally
 * anything and the renderer has to cope. Three scrapers feed this pipeline and
 * they disagree about everything: important dates arrive as an object map from
 * one and as an array of records from another; a fee table is sometimes
 * `{category, fee}` and sometimes `{Category, Fee}`; a vacancy breakdown is an
 * array of objects whose keys vary row to row.
 *
 * So there is exactly one place that decides what those shapes mean, and both
 * ends of the pipeline use it:
 *
 *   - **Ingest** runs these to normalise before writing, so the stored JSON is
 *     already in the rendered shape.
 *   - **The page** runs them again to narrow `Json` to a type, which is cheap
 *     and idempotent on already-normalised input.
 *
 * The alternative — normalise on write only — means every row written before
 * the current parser is unrenderable, and every row from a scraper that has not
 * been updated yet is a runtime crash on a statically generated page.
 *
 * One import, and it is a pure function for the same reason everything else
 * here is: this runs inside a Server Component, inside the ingest worker, and
 * inside a plain Node backfill script.
 */

import { decodeEntities } from "@/lib/format/text";

export type ImportantDate = {
  event: string;
  /** As printed. Free text, because "Third week of March" is a real answer. */
  date: string;
};

export type FeeRow = {
  category: string;
  fee: string;
};

/**
 * A vacancy breakdown, as columns and rows rather than an array of objects.
 *
 * The old page rendered `Object.keys(rows[0])` as the header and then
 * `Object.values(row)` for each row — which silently misaligns the moment one
 * row has a key the first row did not, printing values under the wrong
 * headings. Fixing the column order once, here, makes that impossible.
 */
export type VacancyTable = {
  columns: string[];
  rows: string[][];
};

export type OverviewEntry = {
  label: string;
  value: string;
};

export type DetailLink = {
  text: string;
  url: string;
};

/* ── Primitives ─────────────────────────────────────────────────────────── */

function text(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = decodeEntities(value).trim();
    return trimmed === "" ? null : trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

/**
 * Values the scrapers write in place of an empty cell.
 *
 * "nil" and "none" are on this list and that is right for a date, a count or an
 * overview entry — but wrong for money, where "Nil" is the answer rather than
 * the absence of one. See `FEE_PLACEHOLDER`.
 */
const PLACEHOLDER =
  /^(n\.?\s*\/?\s*a\.?|na|nil|none|null|undefined|not\s*available|not\s*specified|not\s*mentioned|-+|—+)$/i;

/**
 * The same test for a fee column, minus the words that mean "free".
 *
 * A concessional row reading "Nil" is the single most useful line in a fee
 * table: it is how a notification says SC/ST/PwD and women candidates pay
 * nothing. Treating it as an empty cell deleted exactly those rows and left the
 * table showing only what the general category pays — which is the opposite of
 * informative.
 */
const FEE_PLACEHOLDER =
  /^(n\.?\s*\/?\s*a\.?|na|null|undefined|not\s*available|not\s*specified|not\s*mentioned|-+|—+)$/i;

function meaningful(value: unknown): string | null {
  const t = text(value);
  if (t === null || PLACEHOLDER.test(t)) return null;
  return t;
}

function meaningfulFee(value: unknown): string | null {
  const t = text(value);
  if (t === null || FEE_PLACEHOLDER.test(t)) return null;
  return t;
}

/** "post_name" → "Post Name". The scrapers emit raw JSON keys as headings. */
export function humanise(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses a value that may be JSON in a string.
 *
 * A Sheets cell holding JSON arrives as text; the same field from PostgREST
 * arrives already parsed. Both are normal.
 */
function unpack(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

/** First present key, checked case-insensitively. */
function pick(record: Record<string, unknown>, ...names: string[]): unknown {
  const lower = new Map(Object.entries(record).map(([k, v]) => [k.toLowerCase(), v]));
  for (const name of names) {
    const hit = lower.get(name.toLowerCase());
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/* ── Important dates ────────────────────────────────────────────────────── */

/**
 * Rows whose "date" is a link rather than a date.
 *
 * Source tables routinely put "Click Here" in the date column with the real
 * value behind an anchor. Rendering that as a date prints the word "Click" in a
 * column of dates; dropping the row loses the link entirely. So they are
 * separated: `toImportantDates` keeps the dates, `toDateLinks` keeps the links.
 */
const LINK_TEXT = /^(click\s*here|download|link|view|apply\s*online|register)/i;

export function toImportantDates(value: unknown): ImportantDate[] {
  const source = unpack(value);
  const out: ImportantDate[] = [];
  const seen = new Set<string>();

  const add = (rawEvent: unknown, rawDate: unknown) => {
    const event = meaningful(rawEvent);
    const date = meaningful(rawDate);
    if (!event || !date) return;
    if (LINK_TEXT.test(date) || /^https?:\/\//i.test(date)) return;

    // Same event and date from two scrapers is one fact, not two rows.
    const key = `${event.toLowerCase()}|${date.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);

    out.push({ event: /[a-z]/.test(event) ? event : humanise(event), date });
  };

  if (Array.isArray(source)) {
    for (const entry of source) {
      if (!isRecord(entry)) continue;
      add(
        pick(entry, "event", "label", "title", "name", "particulars", "activity"),
        pick(entry, "date", "value", "schedule", "on"),
      );
    }
  } else if (isRecord(source)) {
    // The object-map shape: { application_start: "2026-01-01", ... }
    for (const [key, entry] of Object.entries(source)) {
      add(humanise(key), entry);
    }
  }

  return out;
}

/** The "Click here" rows, recovered as links rather than discarded. */
export function toDateLinks(value: unknown): DetailLink[] {
  const source = unpack(value);
  if (!Array.isArray(source)) return [];

  const out: DetailLink[] = [];
  for (const entry of source) {
    if (!isRecord(entry)) continue;
    const url = meaningful(pick(entry, "link", "url", "href"));
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const label = meaningful(pick(entry, "event", "label", "title", "name")) ?? "Official link";
    out.push({ text: label, url });
  }
  return out;
}

/* ── Fees ───────────────────────────────────────────────────────────────── */

export function toFeeRows(value: unknown): FeeRow[] {
  const source = unpack(value);
  const out: FeeRow[] = [];

  const add = (rawCategory: unknown, rawFee: unknown) => {
    const category = meaningful(rawCategory);
    const fee = meaningfulFee(rawFee);
    if (!category || !fee) return;
    out.push({ category, fee });
  };

  if (Array.isArray(source)) {
    for (const entry of source) {
      if (!isRecord(entry)) continue;
      add(
        pick(entry, "category", "candidate", "class", "type", "label"),
        pick(entry, "fee", "amount", "value", "charges"),
      );
    }
  } else if (isRecord(source)) {
    for (const [key, entry] of Object.entries(source)) add(humanise(key), entry);
  }

  return out;
}

/**
 * The highest fee named in a fee table, as a number.
 *
 * The `application_fee` column carries one figure and the table carries the
 * breakdown; when the column is empty the table can still answer "what will
 * this cost me", and the honest answer to show a stranger is the unconcessional
 * rate rather than the cheapest line in the table.
 */
export function maxFee(rows: FeeRow[]): number | null {
  let max: number | null = null;
  for (const row of rows) {
    const cleaned = row.fee.replace(/rs\.?/gi, "").replace(/[₹,\s/-]+/g, "");
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (max === null || n > max) max = n;
  }
  return max;
}

/* ── Vacancy breakdown ──────────────────────────────────────────────────── */

/**
 * Column headings a scraper has repeated as a data row.
 *
 * Source tables are read with the header row included often enough that the
 * old detail page carried this same list — in the renderer, where it ran on
 * every view of every page. It belongs here, where it runs once.
 */
const HEADER_ECHO = new Set([
  "post name",
  "post_name",
  "name of post",
  "name of the post",
  "total posts",
  "total_posts",
  "no of posts",
  "no. of posts",
  "number of posts",
  "vacancy",
  "vacancies",
  "category",
  "posts",
  "sl no",
  "s.no",
  "sr no",
]);

/** Columns above this and the table stops being readable on a phone. */
const MAX_COLUMNS = 8;
/** A breakdown longer than this is a document, not a table on a job page. */
const MAX_ROWS = 60;

export function toVacancyTable(value: unknown): VacancyTable | null {
  const source = unpack(value);

  // Already normalised — the shape ingest writes.
  if (isRecord(source) && Array.isArray(source.columns) && Array.isArray(source.rows)) {
    const columns = source.columns.map((c) => text(c) ?? "").slice(0, MAX_COLUMNS);
    const rows = source.rows
      .filter((r): r is unknown[] => Array.isArray(r))
      .map((r) => r.map((cell) => text(cell) ?? "").slice(0, MAX_COLUMNS))
      .slice(0, MAX_ROWS);
    return columns.length > 0 && rows.length > 0 ? { columns, rows } : null;
  }

  if (!Array.isArray(source)) return null;

  // Column order is taken from the union of every row's keys, in first-seen
  // order, so a row carrying an extra key adds a column instead of shifting
  // every value one place left.
  const columns: string[] = [];
  const records: Record<string, unknown>[] = [];

  for (const entry of source) {
    if (!isRecord(entry)) continue;
    records.push(entry);
    for (const key of Object.keys(entry)) {
      if (!columns.includes(key)) columns.push(key);
    }
  }

  if (columns.length === 0 || records.length === 0) return null;
  const kept = columns.slice(0, MAX_COLUMNS);

  const rows: string[][] = [];
  for (const record of records) {
    const cells = kept.map((column) => text(record[column]) ?? "");
    if (cells.every((cell) => cell === "")) continue;
    // A row whose every cell echoes a column heading is the header, read as
    // data. Printing it puts "Post Name | Total Posts" inside the table body.
    if (cells.every((cell) => cell === "" || HEADER_ECHO.has(cell.toLowerCase()))) continue;
    rows.push(cells);
    if (rows.length >= MAX_ROWS) break;
  }

  return rows.length > 0 ? { columns: kept.map(humanise), rows } : null;
}

/* ── Selection process ──────────────────────────────────────────────────── */

export function toSteps(value: unknown): string[] {
  const source = unpack(value);

  const out: string[] = [];
  const push = (entry: unknown) => {
    const t = meaningful(entry);
    if (t) out.push(t);
  };

  if (Array.isArray(source)) {
    for (const entry of source) {
      if (isRecord(entry)) push(pick(entry, "step", "stage", "name", "label", "value"));
      else push(entry);
    }
  } else if (isRecord(source)) {
    for (const entry of Object.values(source)) push(entry);
  } else {
    // A single string: split on newlines or numbered prefixes, not on commas —
    // "Written test, Interview" is two steps but "Physical Efficiency Test,
    // including a 1600m run" is one.
    const t = meaningful(source);
    if (t) {
      for (const line of t.split(/\r?\n|(?=\b\d\.\s)/)) push(line.replace(/^\d+[.)]\s*/, ""));
    }
  }

  return out.slice(0, 20);
}

/* ── Overview ───────────────────────────────────────────────────────────── */

/**
 * Keys the detail page already renders somewhere better.
 *
 * The scraped `overview` blob is a grab-bag: it repeats the key facts table,
 * and it carries `salary_text`, `age_limit_text`, `notification_pdf` and
 * `official_website` — every one of which now has a column and a section of its
 * own. Left in, a production job page printed "Age Limit Text" as a row of
 * small print immediately below the section that renders the same paragraph
 * properly.
 */
const OVERVIEW_DUPLICATES = new Set([
  "post name",
  "job title",
  "title",
  "total vacancy",
  "total vacancies",
  "vacancies",
  "last date",
  "application fee",
  "salary",
  "salary text",
  "age limit",
  "age limit text",
  "qualification",
  "eligibility",
  "notification pdf",
  "official website",
  "apply link",
  "apply online",
  "description",
]);

export function toOverview(value: unknown): OverviewEntry[] {
  const source = unpack(value);
  const out: OverviewEntry[] = [];

  const add = (rawLabel: unknown, rawValue: unknown) => {
    const rawLabelText = text(rawLabel);
    const label = rawLabelText === null ? null : humanise(rawLabelText);
    const entryValue = meaningful(rawValue);
    if (!label || !entryValue) return;
    // Not repeated from the key-facts table two sections up the page.
    if (OVERVIEW_DUPLICATES.has(label.toLowerCase())) return;
    out.push({ label, value: entryValue });
  };

  if (isRecord(source)) {
    for (const [key, entry] of Object.entries(source)) add(key, entry);
  } else if (Array.isArray(source)) {
    for (const entry of source) {
      if (!isRecord(entry)) continue;
      add(pick(entry, "label", "key", "name"), pick(entry, "value", "text"));
    }
  }

  return out.slice(0, 25);
}
