import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { publicDb } from "../clients";
import { unwrap } from "../errors";
import { tags } from "../tags";

/**
 * Calendar reads.
 *
 * A month at a time, never "all deadlines". The bound is the month itself,
 * which is also the unit the page renders — asking for a range the screen does
 * not show is the habit that produced the 8.8 MB feed pull in the old app.
 */

export interface CalendarEvent {
  id: string;
  slug: string;
  title: string;
  /** ISO date, `YYYY-MM-DD`. The grid keys off this string directly. */
  date: string;
  organization: string | null;
}

/**
 * Every application deadline falling inside one month.
 *
 * Public content, so it caches and carries the job-list tag: a job whose
 * closing date is edited must change the calendar too, and tagging here means
 * the page cannot forget to.
 */
export async function listDeadlinesInMonth(
  year: number,
  month: number,
): Promise<CalendarEvent[]> {
  "use cache";
  cacheLife("feed");
  cacheTag(tags.jobList());

  const { first, last } = monthBounds(year, month);

  const rows = unwrap(
    "listDeadlinesInMonth",
    await publicDb()
      .from("jobs")
      .select("id, slug, title, last_date, organization:organizations ( short_name, name )")
      .eq("status", "published")
      .gte("last_date", first)
      .lte("last_date", last)
      .order("last_date", { ascending: true })
      // A month of deadlines is naturally bounded, but the bound is stated
      // rather than assumed — one bad ingest should not become an unbounded
      // response.
      .limit(300),
  );

  return (
    rows
      // The `gte`/`lte` above already exclude nulls, but the generated type
      // still says nullable. Narrowing with a filter rather than an assertion:
      // this codebase bans `!`, and a cast here would be claiming something the
      // compiler cannot see rather than proving it.
      .filter((row): row is typeof row & { last_date: string } => row.last_date !== null)
      .map((row) => ({
        id: row.id,
        slug: row.slug,
        title: row.title,
        date: row.last_date,
        organization: row.organization?.short_name ?? row.organization?.name ?? null,
      }))
  );
}

/**
 * First and last day of a month as ISO dates.
 *
 * Built from UTC parts rather than a local `Date`, because the server's zone is
 * not the user's: `new Date(2026, 10, 1)` in a negative-offset zone is the 31st
 * of the previous month, which silently shifts every month boundary by a day.
 */
export function monthBounds(year: number, month: number): { first: string; last: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    first: `${String(year)}-${pad(month)}-01`,
    last: `${String(year)}-${pad(month)}-${pad(daysInMonth)}`,
  };
}
