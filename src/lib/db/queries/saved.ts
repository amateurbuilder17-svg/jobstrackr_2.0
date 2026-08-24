import "server-only";

import { sessionDb } from "../clients";
import { PAGE_SIZE } from "../cursor";
import { unwrap } from "../errors";
import { JOB_CARD_SELECT, type JobCard } from "./jobs";

/**
 * Saved-job reads.
 *
 * Nothing here caches, and nothing here may. Every row belongs to one user, so
 * a `"use cache"` scope would risk serving one person's shortlist to the next
 * visitor — the reason personalisation and caching are a dangerous pair. These
 * run per request against `sessionDb`, under RLS.
 */

export interface SavedJob {
  saved_at: string;
  note: string | null;
  /**
   * Nullable because the join can legitimately come back empty: RLS hides jobs
   * that have been unpublished since they were saved. The list filters those
   * out rather than rendering a card with no title.
   */
  job: JobCard | null;
}

/**
 * Just the ids, to light up every save button on a page.
 *
 * Deliberately separate from the full list. A job list renders 20 cards and
 * needs one bit per card; fetching 20 whole rows to colour in 20 icons would be
 * the whole-table-fetch mistake in miniature.
 */
export async function listSavedJobIds(): Promise<string[]> {
  const db = await sessionDb();

  const rows = unwrap(
    "listSavedJobIds",
    await db
      .from("saved_jobs")
      .select("job_id")
      .order("saved_at", { ascending: false })
      .limit(PAGE_SIZE.savedIds),
  );

  return rows.map((row) => row.job_id);
}

/** The /saved page: full cards, newest save first. */
export async function listSavedJobs(): Promise<SavedJob[]> {
  const db = await sessionDb();

  const rows: SavedJob[] = unwrap(
    "listSavedJobs",
    await db
      .from("saved_jobs")
      .select(`saved_at, note, job:jobs ( ${JOB_CARD_SELECT} )`)
      .order("saved_at", { ascending: false })
      .limit(PAGE_SIZE.list),
  );

  return rows;
}
