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
 * The largest application fee worth believing, in rupees.
 *
 * The sibling of `MIN_PLAUSIBLE_SALARY` and `MAX_PLAUSIBLE_VACANCIES` in
 * `sync/normalize.ts`, and it exists for the same reason: these tables are
 * scraped by column position, so the wrong column lands here regularly. Across
 * every fee this project has ever parsed the highest is ₹5,000 and the median
 * is ₹500, so a five-figure "fee" is a salary or a pay-matrix figure that has
 * drifted one column left.
 */
export const MAX_PLAUSIBLE_FEE = 10_000;

/**
 * Units that mean the number beside them is not money.
 *
 * Real rows this catches: `"32 years"` and `"35 years (Min. Age- 30 years)"`,
 * in the fee column, because an eligibility table was read as a fee table. A
 * parser that simply took the first number would price those jobs at ₹32.
 * `nd`/`st`/`th` catch the other shape of it — `"Not applicable under 72nd CCE
 * after corrigendum"` is not a ₹72 fee.
 */
const NOT_MONEY = /^(years?|yrs?|months?|days?|hours?|marks?|%|st|nd|rd|th|am|pm)\b/i;

/**
 * What has to sit immediately in front of a number for it to be a price.
 *
 * The other half of the same problem, and the real cell that forced it:
 *
 *   "Not required to pay again if already paid for Advt. No. 1440/E-12015/…"
 *
 * That is an advertisement number in the fee column of a table whose other two
 * rows say ₹1,000, and reading the first number in it prices the job at ₹1,440.
 * No blocklist of reference words is going to stay ahead of the ways a document
 * reference can be written, so this is an allowlist: a number counts as money
 * when it opens the cell or when something naming money introduces it.
 *
 * Checked against every fee cell in the database, it rejects three: that advt
 * number, a corrigendum reference, and "USD $30" — which is also right, since
 * this column is rupees and $30 is not ₹30.
 */
const MONEY_BEFORE = /(₹|rs\.?|inr|rupees|fees?|charges?|amount|payable|cost)\s*[:\-–—]?\s*$/i;

/**
 * Wordings that mean the fee is zero, as opposed to unknown.
 *
 * This distinction is the whole point of the list. "Nil" is the single
 * commonest value in this column — 466 cells of it — and it is an answer: the
 * post is free to apply for, which is worth telling someone. "No application
 * fee is mentioned in the official notification" reads almost identically and
 * is the opposite: nobody knows. So this is an exact-match set after asides are
 * stripped, not a prefix test, because a prefix test on "no application fee"
 * would swallow the second one and print "No fee" on a page that has no idea.
 */
const NO_FEE = new Set([
  "nil",
  "none",
  "free",
  "zero",
  "no fee",
  "no fees",
  "nil fee",
  "no application fee",
  "no application fees",
  "application fee exempted",
  "fee exempted",
  "exempt",
  "exempted",
  "not applicable",
]);

/**
 * One fee cell, as a number of rupees, or null when it does not say.
 *
 * Zero is a real answer here and null is not the same thing — see `NO_FEE`.
 *
 * The number taken is the FIRST one outside any parenthetical, which is the
 * behaviour `extractFirstNumber` in `apps-script/JobScraper.gs` already has and
 * the reason both readings come out right:
 *
 *   "Rs. 1500/- (Rs. 800 Application Fee + Rs. 700 Processing Fee)" → 1500
 *   "Rs. 148/- (including 18% GST)"                                → 148
 *   "Rs. 600 + 18% GST"                                            → 600
 *
 * Taking the largest would price the first at ₹800; keeping the parenthetical
 * would price the second at ₹18.
 */
export function feeAmount(value: string): number | null {
  // Asides carry decoy numbers, and they also carry the words that qualify a
  // "Nil" — "NIL (Exempted)" is still nil.
  const withoutAsides = value.replace(/\([^)]*\)/g, " ");

  const words = withoutAsides
    .replace(/\s+/g, " ")
    .replace(/[.,\-–—/\s]+$/g, "")
    .trim()
    .toLowerCase();
  if (NO_FEE.has(words)) return 0;

  const match = /\d[\d,]*(?:\.\d+)?/.exec(withoutAsides);
  if (!match) return null;

  const before = withoutAsides.slice(0, match.index);
  if (before.trim() !== "" && !MONEY_BEFORE.test(before)) return null;

  const after = withoutAsides.slice(match.index + match[0].length).trimStart();
  if (NOT_MONEY.test(after)) return null;

  const n = Number(match[0].replace(/,/g, ""));
  if (!Number.isFinite(n) || n < 0 || n > MAX_PLAUSIBLE_FEE) return null;
  return n;
}

/**
 * The highest fee named in a fee table, as a number.
 *
 * The `application_fee` column carries one figure and the table carries the
 * breakdown; when the column is empty the table can still answer "what will
 * this cost me", and the honest answer to show a stranger is the unconcessional
 * rate rather than the cheapest line in the table.
 *
 * A table whose every readable line is free returns 0, not null. Those are the
 * same value to `Number`, which is exactly why the old version lost them: it
 * skipped anything that was not strictly positive, so a notification saying
 * every category pays nothing rendered as if the fee were unknown. `jobs`
 * already treats 0 as an answer — the detail page prints "No fee" for it and
 * `sync/changes.ts` has a wording for it — so this was the one place that did
 * not.
 */
export function maxFee(rows: FeeRow[]): number | null {
  let max: number | null = null;
  let free = false;

  for (const row of rows) {
    const n = feeAmount(row.fee);
    if (n === null) continue;
    if (n === 0) {
      free = true;
      continue;
    }
    if (max === null || n > max) max = n;
  }

  // A concessional "Nil" beside a general "₹500" is not a free job; the highest
  // rate still stands. Zero only wins when nothing else was readable.
  return max ?? (free ? 0 : null);
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

/**
 * The vacancy count a breakdown table implies, or null.
 *
 * The sibling of `maxFee`, and it exists for the same reason: 727 of the 2,601
 * published rows have no `vacancies`, 551 of them carry the literal string
 * "Not Found" in `vacancies_display` — and 186 of those *do* have a breakdown
 * table whose "Total Posts" column answers the question in the notification's
 * own numbers. The page was printing "Check notice" two sections above a table
 * that said 24.
 *
 * Checked against every breakdown in the database that also has a typed count:
 * it agrees exactly on 537 of 561 and declines to answer on 10. Of the 14 that
 * differ, most are tables that list only some of the posts — an undercount, and
 * the reason this is a *fallback* rather than a correction of a stated figure.
 */
export function totalVacancies(table: VacancyTable | null): number | null {
  if (!table) return null;

  const column = countColumn(table);
  if (column === -1) return null;

  // Three populations, because a table that carries its own total must not have
  // that total added to the rows it is the total *of*.
  let grand: number | null = null;
  let subtotal = 0;
  let subtotals = 0;
  let sum = 0;
  let counted = 0;

  for (const row of table.rows) {
    const n = cellCount(row[column]);
    if (n === null) continue;

    const labels = row.filter((_, i) => i !== column);
    if (labels.some((label) => GRAND_TOTAL_ROW.test(label))) {
      grand = grand === null || n > grand ? n : grand;
      continue;
    }
    // "Total", "Grand Total", "Category-I Total", "Total (new posts)" — matched
    // anywhere in the label rather than at the start, because a UPSC table
    // whose last row reads "Category-I Total" is a total row and summing it
    // with the six rows above it reported exactly twice the real figure.
    if (labels.some((label) => TOTAL_ROW.test(label))) {
      subtotal += n;
      subtotals += 1;
      continue;
    }

    sum += n;
    counted += 1;
  }

  const total = grand ?? (subtotals > 0 ? subtotal : counted > 0 ? sum : null);
  // Zero is an answer for one row of a table — "Geophysicist: 0" — but as the
  // total of the whole breakdown it means the column held nothing countable.
  return total === null || total <= 0 || total > MAX_TOTAL_VACANCIES ? null : total;
}

/** A row that states the whole table's figure rather than one post's. */
const TOTAL_ROW = /\btotals?\b/i;
const GRAND_TOTAL_ROW = /\bgrand\s+totals?\b/i;

/**
 * The same ceiling `toVacancies` applies to the typed column, restated rather
 * than imported: this module is the page's parser and must not depend on the
 * ingest worker's. India's largest recent notification was ~150,000 posts, so
 * anything above a million is a column read by mistake.
 */
const MAX_TOTAL_VACANCIES = 1_000_000;

/**
 * Headings that hold a count, in the order they should be trusted.
 *
 * Ranked rather than merged, because a table can carry both "Total Posts" and a
 * per-category split, and adding the two double-counts every row. Bare "Total"
 * comes last: it is a count in a vacancy table, but it is also what a fee or a
 * pay table calls its rightmost column.
 */
const COUNT_HEADINGS = [
  /^total\s+(no\.?\s*of\s*)?(posts?|vacanc(y|ies)|seats?)$/i,
  /^((no\.?|nos\.?|number)\s*of\s*)?(posts?|vacanc(y|ies)|seats?|openings?)$/i,
  /^total$/i,
] as const;

/**
 * The column to count, or -1.
 *
 * Within a rank the column with the most readable numbers wins, which is what
 * separates the two identically named columns in a Southern Railway table —
 * `columns: ["Unit", "Trades Covered", "Total Posts", "Post Name", "Total
 * Posts"]`, where the second holds one grand total and the first holds the four
 * rows it totals.
 */
function countColumn(table: VacancyTable): number {
  for (const heading of COUNT_HEADINGS) {
    let best = -1;
    let bestFilled = 0;

    table.columns.forEach((column, i) => {
      if (!heading.test(column.trim())) return;
      const filled = table.rows.filter((row) => cellCount(row[i]) !== null).length;
      if (filled > bestFilled) {
        best = i;
        bestFilled = filled;
      }
    });

    if (best !== -1) return best;
  }
  return -1;
}

/**
 * One cell of a count column, as a number.
 *
 * The leading number only, and only when it opens the cell: "23 (5 Typist + 4
 * Typist Copyist + 9 Process Server + 5 Peon)" is 23 posts, and taking the
 * largest number in it would say 9. A cell that opens with anything else — a
 * post name that drifted a column left — is not a count.
 */
function cellCount(cell: string | undefined): number | null {
  if (cell === undefined) return null;
  const withoutAsides = cell.replace(/\([^)]*\)/g, " ").trim();
  const match = /^\d[\d,]*\b/.exec(withoutAsides);
  if (!match) return null;
  const n = Number(match[0].replace(/,/g, ""));
  return Number.isInteger(n) && n >= 0 && n <= MAX_TOTAL_VACANCIES ? n : null;
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
