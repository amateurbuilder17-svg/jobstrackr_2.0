/**
 * Deadline arithmetic.
 *
 * Every date in this app is a calendar date in India, not an instant. A closing
 * date of 2026-03-10 means end of that day in IST regardless of where the
 * reader is, so the comparison must be day-to-day in Asia/Kolkata — never
 * `Date.now()` against a parsed timestamp.
 *
 * Getting this wrong is not cosmetic. A server in UTC computing "days left"
 * against an IST deadline shows a job as closed for the last five and a half
 * hours it is actually open, which for someone applying on the final evening
 * is the difference between applying and not.
 */

const IST = "Asia/Kolkata";

/** Today's calendar date in India, as YYYY-MM-DD. */
export function todayInIndia(now: Date = new Date()): string {
  // `en-CA` formats as YYYY-MM-DD, which sorts and compares as a string.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Whole days from today (IST) until `date`. Negative once the date has passed. */
export function daysUntil(date: string | null, now: Date = new Date()): number | null {
  return daysUntilFrom(todayInIndia(now), date);
}

/**
 * The same arithmetic, from an IST calendar date already in hand.
 *
 * The UI computes "today" once per page and passes it down (see
 * `TodayProvider`), so the common path should not have to round-trip that
 * string back through a `Date` and a timezone conversion to be usable.
 */
export function daysUntilFrom(today: string, date: string | null): number | null {
  if (!date) return null;

  const target = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  const from = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(target) || Number.isNaN(from)) return null;

  return Math.round((target - from) / 86_400_000);
}

export type DeadlineUrgency = "closed" | "today" | "urgent" | "soon" | "open";

export interface Deadline {
  urgency: DeadlineUrgency;
  daysLeft: number | null;
  label: string;
  /** Maps to a Badge tone. Derived from the date, never chosen by a caller. */
  tone: "critical" | "warn" | "neutral";
}

/**
 * Thresholds are chosen around how people actually behave, not round numbers.
 * Three days is roughly when an application stops being "later this week" and
 * starts being tonight's job; two weeks is when it is worth a calendar entry.
 */
export function describeDeadline(date: string | null, now: Date = new Date()): Deadline {
  return describeDeadlineFrom(todayInIndia(now), date);
}

/** `describeDeadline` from an IST calendar date already in hand. */
export function describeDeadlineFrom(today: string, date: string | null): Deadline {
  const daysLeft = daysUntilFrom(today, date);

  if (daysLeft === null) {
    return { urgency: "open", daysLeft: null, label: "Date not announced", tone: "neutral" };
  }
  if (daysLeft < 0) {
    return { urgency: "closed", daysLeft, label: "Closed", tone: "neutral" };
  }
  if (daysLeft === 0) {
    return { urgency: "today", daysLeft, label: "Last day", tone: "critical" };
  }
  if (daysLeft <= 3) {
    return {
      urgency: "urgent",
      daysLeft,
      label: `${String(daysLeft)} day${daysLeft === 1 ? "" : "s"} left`,
      tone: "critical",
    };
  }
  if (daysLeft <= 14) {
    return { urgency: "soon", daysLeft, label: `${String(daysLeft)} days left`, tone: "warn" };
  }
  return { urgency: "open", daysLeft, label: `${String(daysLeft)} days left`, tone: "neutral" };
}

/** "10 Mar 2026" — unambiguous, and the order Indian readers expect. */
export function formatDate(date: string | null): string | null {
  if (!date) return null;
  const parsed = new Date(`${date.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(parsed);
}

/**
 * A timestamp with the time of day, for operational tables.
 *
 * Rendered in IST rather than UTC, unlike `formatDate`: this is read by one
 * team in one timezone deciding whether a run finished half an hour ago, and
 * "14:05" meaning something other than the clock on the wall is a trap.
 */
export function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(parsed);
}

/**
 * The closing date as a person should read it.
 *
 * `last_date_display` exists to carry what the notification actually said —
 * "TBD", "Walk-in", "Third week of March" — the answers a `date` column cannot
 * hold. So preferring it over the typed date is right in principle, and wrong
 * for most of the corpus: 4,884 of 6,003 production rows have a raw ISO string
 * in that column, and the detail page duly printed "2026-08-25" in a field
 * headed "Closes".
 *
 * So the rule is narrower than "prefer the display string". Prefer it only
 * when it says something a date cannot: if it is itself a machine date, the
 * formatted column is the better rendering of the same fact.
 */
export function formatDeadlineText(display: string | null, date: string | null): string | null {
  const text = display?.trim();
  if (!text) return formatDate(date);

  // ISO, or the other machine renderings that turn up in this column.
  const machine =
    /^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(text) || /^\d{2}[/-]\d{2}[/-]\d{4}$/.test(text);
  if (!machine) return text;

  // Format the display string itself when the typed column is empty — the two
  // disagree often enough that falling back to `date` would silently show a
  // different day.
  return formatDate(date) ?? formatDate(text.slice(0, 10)) ?? text;
}

/** Indian digit grouping: 17,727 but 1,77,270. */
export function formatCount(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat("en-IN").format(value);
}

/**
 * A vacancy count, ready to render on its own.
 *
 * The caller must not append the word "vacancies" — this returns it, or a
 * source string that already carries its own noun.
 *
 * That distinction is the bug this function exists to remove. The row used to
 * render `vacancies_display ?? formatCount(vacancies)` and then print the
 * literal word "vacancies" after it. `vacancies_display` is free text scraped
 * from the notice, and it frequently already contains a noun — "10 Posts" — so
 * the list showed "10 Posts vacancies" on every such row.
 *
 * The rule: if the source string ends in a word, trust it and print it
 * verbatim. Only a bare number gets a noun supplied, and it is pluralised.
 */
export function formatVacancies(display: string | null, count: number | null): string | null {
  const text = display?.trim();

  // The feed writes a placeholder rather than leaving the cell empty, so
  // "Not Available" arrives as a value and rendered as one — a job row that
  // announced, in the slot where a vacancy count belongs, that there was no
  // vacancy count. An absent fact should read as absent: the row simply omits
  // the field, which is what every other null here already does.
  if (text && PLACEHOLDER.test(text)) return formatFromCount(count);

  if (text) {
    // A display value that is only digits and separators is a count with no
    // noun of its own — "1,200" — so it still needs one.
    return /^[\d,\s]+$/.test(text) ? withNoun(text, Number(text.replace(/[^\d]/g, ""))) : text;
  }

  return formatFromCount(count);
}

/**
 * Placeholders the feed writes in place of an empty cell. Matched whole, not as
 * a substring: "Various Posts" is a real answer and must survive.
 *
 * "Not Found" is the one that mattered most and was the one missing: it is what
 * 551 of the 2,601 published rows carry in `vacancies_display`, so a fifth of
 * every listing page announced "Not Found" in the slot where a vacancy count
 * belongs — including rows whose breakdown table states the figure.
 */
const PLACEHOLDER =
  /^(not\s*(available|found|specified|mentioned|disclosed|announced)|n\.?\s*\/?\s*a\.?|nil|none|tbd|to\s*be\s*(announced|decided|notified)|-+|—+|unknown|check\s*(the\s*)?(notice|notification)|as\s*per\s*(the\s*)?notification)$/i;

function formatFromCount(count: number | null): string | null {
  const formatted = formatCount(count);
  return formatted === null ? null : withNoun(formatted, count);
}

function withNoun(formatted: string, count: number | null): string {
  return `${formatted} ${count === 1 ? "vacancy" : "vacancies"}`;
}

/** Salary as a range, in the compact form a listing would print. */
export function formatSalary(min: number | null, max: number | null): string | null {
  const fmt = (n: number) => `₹${new Intl.NumberFormat("en-IN").format(n)}`;
  if (min !== null && max !== null && min !== max) return `${fmt(min)} – ${fmt(max)}`;
  if (min !== null) return fmt(min);
  if (max !== null) return fmt(max);
  return null;
}
