import "server-only";

import { adminOnly, type AdminPage } from "./admin";
import { unwrap } from "../errors";

/**
 * Expired listings.
 *
 * `close_expired_jobs()` already moves a published listing past its closing
 * date to `closed` on every ingest run, so nothing here is about hiding expired
 * jobs from visitors — they are already out of the feeds. This page exists to
 * decide what happens to the ones that accumulate.
 *
 * The counts are the reason it is not just another paged table. Deleting a job
 * cascades into `saved_jobs` and `user_calendar_events`, so a row somebody has
 * shortlisted cannot be cleared out the way an untouched one can. Those two
 * numbers come back per row and decide which button the page offers.
 */

export type ExpiredSort = "oldest" | "newest" | "smallest";

const SORTS: readonly ExpiredSort[] = ["oldest", "newest", "smallest"];

/** A sort arriving from the query string is a string until proved otherwise. */
export function asExpiredSort(value: string | undefined): ExpiredSort {
  return SORTS.find((s) => s === value) ?? "oldest";
}

/**
 * A year filter from the URL. Anything that is not a plausible closing year is
 * dropped rather than passed through as `NaN`, which reaches Postgres as a
 * malformed literal and fails the whole request.
 */
export function asExpiredYear(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return undefined;
  return year;
}

export interface ExpiredJobRow {
  jobId: string;
  slug: string;
  title: string;
  orgName: string | null;
  status: string;
  lastDate: string | null;
  createdAt: string;
  vacancies: number | null;
  /** People who have this on their shortlist. Deleting would remove it. */
  saves: number;
  /** Calendar reminders pointing at it. Deleting would remove those too. */
  reminders: number;
}

/** True when nothing personal is attached and the row can safely be deleted. */
export function isUnreferenced(row: ExpiredJobRow): boolean {
  return row.saves === 0 && row.reminders === 0;
}

const EXPIRED_PAGE = 50;

export async function listExpiredJobs(options: {
  page?: number;
  year?: number | undefined;
  query?: string | undefined;
  sort?: ExpiredSort;
}): Promise<AdminPage<ExpiredJobRow>> {
  const db = await adminOnly("listExpiredJobs");
  const page = clampPage(options.page);
  const query = options.query?.trim();

  const rows = unwrap(
    "listExpiredJobs",
    await db.rpc("admin_expired_jobs", {
      p_limit: EXPIRED_PAGE,
      p_offset: (page - 1) * EXPIRED_PAGE,
      p_sort: options.sort ?? "oldest",
      // Spread rather than an explicit `undefined`: PostgREST serialises the key
      // either way, and sending `null` is not the same as letting the function's
      // own default apply.
      ...(options.year === undefined ? {} : { p_year: options.year }),
      ...(query ? { p_query: query } : {}),
    }),
  );

  const total = rows[0]?.total ?? 0;

  return {
    rows: rows.map((row) => ({
      jobId: row.job_id,
      slug: row.slug,
      title: row.title,
      orgName: row.org_name,
      status: row.status,
      lastDate: row.last_date,
      createdAt: row.created_at,
      vacancies: row.vacancies,
      saves: row.saves,
      reminders: row.reminders,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / EXPIRED_PAGE)),
  };
}

export interface ExpiredSummary {
  totalExpired: number;
  /** Safe to delete: nobody saved them, nobody has a reminder. */
  unreferenced: number;
  savedByUsers: number;
  /**
   * Expired but still `published`. Should be zero — `close_expired_jobs` runs
   * every ingest — so a number here means ingestion has stopped.
   */
  stillPublished: number;
}

export async function getExpiredSummary(): Promise<ExpiredSummary> {
  const db = await adminOnly("getExpiredSummary");
  const rows = unwrap("getExpiredSummary", await db.rpc("admin_expired_summary"));
  const row = rows[0];

  return {
    totalExpired: row?.total_expired ?? 0,
    unreferenced: row?.unreferenced ?? 0,
    savedByUsers: row?.saved_by_users ?? 0,
    stillPublished: row?.still_published ?? 0,
  };
}

export interface ExpiredYear {
  year: number;
  count: number;
}

export async function getExpiredYears(): Promise<ExpiredYear[]> {
  const db = await adminOnly("getExpiredYears");
  const rows = unwrap("getExpiredYears", await db.rpc("admin_expired_years"));
  return rows.map((row) => ({ year: row.year, count: row.n }));
}

function clampPage(page: number | undefined): number {
  if (!page || !Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.trunc(page), 10_000);
}
