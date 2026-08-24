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
  if (!date) return null;

  const target = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  const today = Date.parse(`${todayInIndia(now)}T00:00:00Z`);
  if (Number.isNaN(target) || Number.isNaN(today)) return null;

  return Math.round((target - today) / 86_400_000);
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
  const daysLeft = daysUntil(date, now);

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

/** Indian digit grouping: 17,727 but 1,77,270. */
export function formatCount(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  return new Intl.NumberFormat("en-IN").format(value);
}

/** Salary as a range, in the compact form a listing would print. */
export function formatSalary(min: number | null, max: number | null): string | null {
  const fmt = (n: number) => `₹${new Intl.NumberFormat("en-IN").format(n)}`;
  if (min !== null && max !== null && min !== max) return `${fmt(min)} – ${fmt(max)}`;
  if (min !== null) return fmt(min);
  if (max !== null) return fmt(max);
  return null;
}
