import "server-only";

import { adminDb, sessionDb } from "../clients";
import { PAGE_SIZE } from "../cursor";
import { unwrap } from "../errors";
import { hasRole } from "@/lib/auth/session";
import type { Database } from "../database.types";

/**
 * Admin reads.
 *
 * The old Admin page mounted, set `bypassCache` with `staleTime: 0`, and pulled
 * all ~5,231 jobs — about 14 MB, uncached, on every mount. That is root cause
 * #4, and it is the reason this file looks the way it does: every function
 * takes a page, every page is 50 rows, and every select names its columns. The
 * unbounded read is not discouraged here, it is absent.
 *
 * Nothing caches: an admin looking at ingestion state needs the truth, not a
 * six-hour-old copy. That is affordable precisely because the rows are bounded.
 */

type JobStatus = Database["public"]["Enums"]["job_status"];
type LinkState = Database["public"]["Enums"]["job_link_state"];

const JOB_STATUSES: readonly JobStatus[] = ["draft", "published", "closed", "archived"];
const LINK_STATES: readonly LinkState[] = ["unresolved", "linked", "no_match", "ambiguous"];

/**
 * A filter arriving from the query string is a string until proved otherwise.
 * Passing it straight through reaches Postgres as an invalid enum literal and
 * fails the whole request, so an unrecognised value is dropped instead.
 */
export function asJobStatus(value: string | undefined): JobStatus | undefined {
  return JOB_STATUSES.find((s) => s === value);
}

export function asLinkState(value: string | undefined): LinkState | undefined {
  return LINK_STATES.find((s) => s === value);
}

export interface AdminPage<T> {
  rows: T[];
  /** Total matching rows, for "page 3 of 42". A count, not the rows. */
  total: number;
  page: number;
  pageCount: number;
}

const ADMIN_JOB_COLUMNS =
  "id, slug, title, status, last_date, published_at, updated_at, organization:organizations ( short_name, name )" as const;

export interface AdminJobRow {
  id: string;
  slug: string;
  title: string;
  status: Database["public"]["Enums"]["job_status"];
  last_date: string | null;
  published_at: string | null;
  updated_at: string;
  organization: { short_name: string | null; name: string } | null;
}

export async function listJobsForAdmin(options: {
  page?: number;
  status?: JobStatus | undefined;
  query?: string | undefined;
}): Promise<AdminPage<AdminJobRow>> {
  const db = await sessionDb();
  const page = clampPage(options.page);
  const from = (page - 1) * PAGE_SIZE.admin;

  let q = db
    .from("jobs")
    // `count: 'exact'` with a range gives the total without fetching it — the
    // number comes back in the Content-Range header, not as rows.
    .select(ADMIN_JOB_COLUMNS, { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(from, from + PAGE_SIZE.admin - 1);

  if (options.status) q = q.eq("status", options.status);
  if (options.query) q = q.ilike("title", `%${options.query}%`);

  const result = await q;
  const rows = unwrap("listJobsForAdmin", result) as unknown as AdminJobRow[];

  return paginate(rows, result.count ?? 0, page);
}

export interface AdminUpdateRow {
  id: string;
  slug: string;
  title: string;
  category: Database["public"]["Enums"]["update_category"];
  job_link_state: Database["public"]["Enums"]["job_link_state"];
  is_published: boolean;
  published_date: string | null;
}

export async function listUpdatesForAdmin(options: {
  page?: number;
  linkState?: LinkState | undefined;
}): Promise<AdminPage<AdminUpdateRow>> {
  const db = await sessionDb();
  const page = clampPage(options.page);
  const from = (page - 1) * PAGE_SIZE.admin;

  let q = db
    .from("exam_updates")
    .select("id, slug, title, category, job_link_state, is_published, published_date", {
      count: "exact",
    })
    .order("scraped_at", { ascending: false })
    .range(from, from + PAGE_SIZE.admin - 1);

  if (options.linkState) q = q.eq("job_link_state", options.linkState);

  const result = await q;
  const rows = unwrap("listUpdatesForAdmin", result);

  return paginate(rows, result.count ?? 0, page);
}

/* ── Ingestion monitor ─────────────────────────────────────────────────── */

export interface SyncRunRow {
  id: string;
  kind: string;
  status: Database["public"]["Enums"]["sync_status"];
  rows_seen: number;
  rows_inserted: number;
  rows_updated: number;
  rows_unchanged: number;
  rows_failed: number;
  started_at: string;
  duration_ms: number | null;
  error: string | null;
}

export async function listSyncRuns(limit = 20): Promise<SyncRunRow[]> {
  const db = await sessionDb();
  return unwrap(
    "listSyncRuns",
    await db
      .from("sync_runs")
      .select(
        "id, kind, status, rows_seen, rows_inserted, rows_updated, rows_unchanged, rows_failed, started_at, duration_ms, error",
      )
      .order("started_at", { ascending: false })
      .limit(limit),
  );
}

export interface DeadLetterRow {
  id: string;
  kind: string;
  source_key: string | null;
  error: string;
  attempts: number;
  created_at: string;
}

/**
 * Open dead-letter rows. Never the payload — that is a whole scraped document
 * per row, and the list only needs to say what failed and why.
 */
export async function listDeadLetter(limit = 20): Promise<DeadLetterRow[]> {
  const db = await sessionDb();
  return unwrap(
    "listDeadLetter",
    await db
      .from("sync_dead_letter")
      .select("id, kind, source_key, error, attempts, created_at")
      .is("resolved_at", null)
      .order("created_at", { ascending: false })
      .limit(limit),
  );
}

/* ── Counts ────────────────────────────────────────────────────────────── */

export interface AdminCounts {
  jobs: number;
  draftJobs: number;
  updates: number;
  unlinkedUpdates: number;
  openDeadLetter: number;
}

/**
 * Five numbers for the overview.
 *
 * `head: true` sends no rows at all — the count arrives in a header. Five of
 * these together are a few hundred bytes, against the ~14 MB the old admin
 * spent to compute the same figures in the browser.
 */
export async function getAdminCounts(): Promise<AdminCounts> {
  const db = await sessionDb();

  // `head: true` returns no rows at all — the count comes back in the
  // Content-Range header. Five of these together are a few hundred bytes,
  // against the ~14 MB the old admin spent computing the same figures in the
  // browser. Written out rather than looped: each has a different filter, and a
  // generic helper needed more casts than the repetition costs.
  const [jobs, draftJobs, updates, unlinkedUpdates, openDeadLetter] = await Promise.all([
    db.from("jobs").select("id", { count: "exact", head: true }),
    db.from("jobs").select("id", { count: "exact", head: true }).eq("status", "draft"),
    db.from("exam_updates").select("id", { count: "exact", head: true }),
    db
      .from("exam_updates")
      .select("id", { count: "exact", head: true })
      .in("job_link_state", ["unresolved", "ambiguous"]),
    db
      .from("sync_dead_letter")
      .select("id", { count: "exact", head: true })
      .is("resolved_at", null),
  ]);

  return {
    jobs: jobs.count ?? 0,
    draftJobs: draftJobs.count ?? 0,
    updates: updates.count ?? 0,
    unlinkedUpdates: unlinkedUpdates.count ?? 0,
    openDeadLetter: openDeadLetter.count ?? 0,
  };
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function clampPage(page: number | undefined): number {
  if (!page || !Number.isFinite(page) || page < 1) return 1;
  // A page number arrives from the URL. Without a ceiling, `?page=1e9` becomes
  // an offset Postgres will happily try to seek to.
  return Math.min(Math.trunc(page), 10_000);
}

function paginate<T>(rows: T[], total: number, page: number): AdminPage<T> {
  return {
    rows,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE.admin)),
  };
}

/* ── Storage, for the egress page ──────────────────────────────────────── */

export interface TableStat {
  table_name: string;
  row_estimate: number;
  total_bytes: number;
  bytes_per_row: number;
}

/**
 * Per-table storage figures.
 *
 * The only function here that uses the secret-key client, because `pg_class` is
 * not readable by the app roles. That makes the role check below load-bearing
 * rather than ceremonial: `adminDb()` ignores RLS entirely, so nothing beneath
 * this line would stop a non-admin. The layout checks too — this is the check
 * that would still be here if the layout were deleted.
 */
export async function getTableStats(): Promise<TableStat[]> {
  const admin = await hasRole("admin");
  if (!admin) throw new Error("getTableStats: not an admin");

  return unwrap("getTableStats", await adminDb().rpc("admin_table_stats"));
}
