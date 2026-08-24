import "server-only";

import { sessionDb } from "../clients";
import { unwrap } from "../errors";
import type { JobCard } from "./jobs";

/**
 * The For You feed.
 *
 * A single RPC call. All the eligibility logic lives in `match_jobs` — see
 * migration 0011 — because that is where the indexes are and where it can be
 * proved. The old app did this in the browser, which is why it also had to ship
 * every row: scoring in JavaScript needs the whole table present.
 *
 * Per-user by definition, so this never caches. It is the one place in the app
 * where a dynamic read is the point rather than a regression.
 */

/** A matched job: the card's columns, plus why it was matched. */
export interface MatchedJob extends JobCard {
  score: number;
  /** Short phrases for the card — "Matches your sectors", "Closing soon". */
  reasons: string[];
}

export async function listMatchedJobs(limit = 50): Promise<MatchedJob[]> {
  const db = await sessionDb();

  const rows = unwrap("listMatchedJobs", await db.rpc("match_jobs", { p_limit: limit }));

  // `organization` arrives as jsonb because the function builds it with
  // to_jsonb(). Its shape is fixed by the function's own select, so this cast
  // is narrowing a deliberately loose transport type rather than papering over
  // an unknown.
  return rows as unknown as MatchedJob[];
}
