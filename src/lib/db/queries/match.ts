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

/** Which single hard filter a job failed. Mirrors `match_jobs_blocked`. */
export type Blocker = "age" | "qualification" | "stream" | "gender" | "experience";

export interface BlockedJob extends JobCard {
  blocker: Blocker;
  /**
   * The value that failed, unformatted. For `age` it is `"min-max|yourAge"`;
   * for the rest it is the enum literal. The sentence is composed in the UI,
   * which already holds the human label for every qualification level and
   * should not have a second copy of them in SQL.
   */
  blocker_value: string;
}

/**
 * Open jobs that fail exactly one hard filter, with that filter named.
 *
 * A feed that only ever removes things cannot be checked by the person reading
 * it. The old app's For You page was trusted because it showed its working —
 * four buckets, each card carrying its reason — and this is the honest half of
 * that: not a relaxation, not a "maybe", but the jobs that came closest and the
 * single thing standing in the way.
 *
 * Nothing here can appear in `listMatchedJobs`: a job failing one test is by
 * construction absent from the set that fails none, and the proof harness
 * asserts it (`nothing is both matched and blocked`).
 */
export async function listBlockedJobs(limit = 12): Promise<BlockedJob[]> {
  const db = await sessionDb();

  const rows = unwrap(
    "listBlockedJobs",
    await db.rpc("match_jobs_blocked", { p_limit: limit }),
  );

  return rows as unknown as BlockedJob[];
}
