import "server-only";

import { adminOnly, type AdminPage } from "./admin";
import { unwrap } from "../errors";

/**
 * The three job-maintenance tools the old admin page carried, rebuilt.
 *
 * Each one asks its question in Postgres and receives only the answer. The
 * difference is not stylistic: the old page's vacancy checker began by pulling
 * all ~5,231 job rows into the browser (~14 MB, uncached, on every mount) so
 * that it could run a regex over the titles and discard 99% of what it had
 * fetched. The same check here is one RPC returning about forty rows.
 *
 * The pattern to preserve if these grow: the filter belongs on the side of the
 * network that has the rows. There is no function in this file that can fetch
 * a whole table, and adding one would undo the reason the file exists.
 */

/* ── Vacancy mismatches ────────────────────────────────────────────────── */

export interface VacancyMismatch {
  jobId: string;
  slug: string;
  title: string;
  /** What `jobs.vacancies` says. Null is the common case — never scraped. */
  stored: number | null;
  /** What the title says. Never null; a row without one is not returned. */
  extracted: number;
  vacanciesDisplay: string | null;
}

const VACANCY_PAGE = 50;

export async function listVacancyMismatches(page = 1): Promise<AdminPage<VacancyMismatch>> {
  const db = await adminOnly("listVacancyMismatches");
  const current = clampPage(page);

  const rows = unwrap(
    "listVacancyMismatches",
    await db.rpc("admin_vacancy_mismatches", {
      p_limit: VACANCY_PAGE,
      p_offset: (current - 1) * VACANCY_PAGE,
    }),
  );

  // `count(*) over ()` rides along on every row, so the total costs nothing
  // extra — and is simply absent when the page is empty.
  const total = rows[0]?.total ?? 0;

  return {
    rows: rows.map((row) => ({
      jobId: row.job_id,
      slug: row.slug,
      title: row.title,
      stored: row.stored,
      extracted: row.extracted,
      vacanciesDisplay: row.vacancies_display,
    })),
    total,
    page: current,
    pageCount: Math.max(1, Math.ceil(total / VACANCY_PAGE)),
  };
}

/* ── Duplicates ────────────────────────────────────────────────────────── */

export interface DuplicateJob {
  jobId: string;
  slug: string;
  title: string;
  orgName: string | null;
  lastDate: string | null;
  sourceUrl: string | null;
  createdAt: string;
  /** The row `merge_duplicate_jobs()` would keep. Exactly one per group. */
  isCanonical: boolean;
}

export interface DuplicateGroup {
  key: string;
  title: string;
  orgName: string | null;
  jobs: DuplicateJob[];
}

export interface DuplicatePage {
  groups: DuplicateGroup[];
  /** Groups, not rows — this page is paged by group. */
  totalGroups: number;
  /** Every listing inside a duplicate group, including the survivors. */
  totalRows: number;
  page: number;
  pageCount: number;
}

const DUPLICATE_PAGE = 20;

/**
 * Duplicate groups, exactly as `merge_duplicate_jobs()` would see them.
 *
 * The preview and the button share their grouping and their survivor ranking
 * in SQL (migration 0034 mirrors 0027/0028), so what is listed here is what
 * merging would actually do. A preview computed differently from the operation
 * it previews is worse than no preview.
 */
export async function listDuplicateGroups(page = 1): Promise<DuplicatePage> {
  const db = await adminOnly("listDuplicateGroups");
  const current = clampPage(page);

  const rows = unwrap(
    "listDuplicateGroups",
    await db.rpc("admin_duplicate_groups", {
      p_limit: DUPLICATE_PAGE,
      p_offset: (current - 1) * DUPLICATE_PAGE,
    }),
  );

  // Rows arrive flat and pre-ordered — group first, canonical first within it.
  // A Map preserves insertion order, so regrouping does not reorder.
  const byKey = new Map<string, DuplicateGroup>();
  for (const row of rows) {
    let group = byKey.get(row.group_key);
    if (!group) {
      group = { key: row.group_key, title: row.title, orgName: row.org_name, jobs: [] };
      byKey.set(row.group_key, group);
    }
    group.jobs.push({
      jobId: row.job_id,
      slug: row.slug,
      title: row.title,
      orgName: row.org_name,
      lastDate: row.last_date,
      sourceUrl: row.source_url,
      createdAt: row.created_at,
      isCanonical: row.is_canonical,
    });
  }

  const totalGroups = rows[0]?.total_groups ?? 0;

  return {
    groups: [...byKey.values()],
    totalGroups,
    totalRows: rows[0]?.total_rows ?? 0,
    page: current,
    pageCount: Math.max(1, Math.ceil(totalGroups / DUPLICATE_PAGE)),
  };
}

/* ── Missing closing dates ─────────────────────────────────────────────── */

export interface MissingDateCandidate {
  jobId: string;
  slug: string;
  title: string;
  /** `last_date_display` — the free text shown while `last_date` is null. */
  display: string | null;
  /** Every date entry the notification printed, unparsed. */
  entries: { event: string; date: string }[];
}

/**
 * Listings with no `last_date` but a date somewhere in their detail row.
 *
 * A null `last_date` means the scrape produced nothing a date column would
 * accept — but `job_details.important_dates` usually still holds what the
 * notification printed, as the free text it printed it in. The RPC finds the
 * candidates and returns only their date entries; the parsing happens in
 * `lib/admin/dates.ts`, because "Third week of March" is a real value in that
 * column and a plpgsql parser for it would be a worse copy of one that exists.
 */
export async function listMissingLastDate(limit = 100): Promise<{
  rows: MissingDateCandidate[];
  total: number;
}> {
  const db = await adminOnly("listMissingLastDate");

  const rows = unwrap(
    "listMissingLastDate",
    await db.rpc("admin_jobs_missing_last_date", { p_limit: limit }),
  );

  return {
    rows: rows.map((row) => ({
      jobId: row.job_id,
      slug: row.slug,
      title: row.title,
      display: row.display,
      entries: toEntries(row.important_dates),
    })),
    total: rows[0]?.total ?? 0,
  };
}

/**
 * `important_dates` is `jsonb`, so the database will hand back anything at all.
 * Narrowed here rather than cast: three scrapers write this column and they
 * have disagreed about its shape before.
 */
function toEntries(value: unknown): { event: string; date: string }[] {
  if (!Array.isArray(value)) return [];

  const out: { event: string; date: string }[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as Record<string, unknown>;
    const event = typeof record.event === "string" ? record.event : "";
    const date = typeof record.date === "string" ? record.date : "";
    if (date !== "") out.push({ event, date });
  }
  return out;
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function clampPage(page: number): number {
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.trunc(page), 10_000);
}
