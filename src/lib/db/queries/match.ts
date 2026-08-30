import "server-only";

import { sessionDb } from "../clients";
import { unwrap } from "../errors";
import type { JobCard } from "./jobs";

/**
 * The For You feed.
 *
 * A single RPC call. All the eligibility logic lives in the database — see
 * migrations 0011, 0012, 0022 and 0028 — because that is where the indexes are
 * and where it can be proved. The old app did this in the browser, which is why
 * it also had to ship every row: scoring in JavaScript needs the whole table
 * present.
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
  // jsonb_build_object(). Its shape is fixed by the function's own select, so
  // this cast is narrowing a deliberately loose transport type rather than
  // papering over an unknown.
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
 * Kept for the home page and for the proof harness, which asserts that
 * `match_feed`'s `can_apply` tier never contains a row `match_jobs` would not
 * have returned. Two implementations checked against each other are safer than
 * one rewrite that is not — see 0028.
 */
export async function listBlockedJobs(limit = 12): Promise<BlockedJob[]> {
  const db = await sessionDb();

  const rows = unwrap(
    "listBlockedJobs",
    await db.rpc("match_jobs_blocked", { p_limit: limit }),
  );

  return rows as unknown as BlockedJob[];
}

// ═══════════════════════════════════════════════════════════════════════════
// The four tiers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Where a posting sits relative to this candidate.
 *
 *   can_apply   every stated requirement is affirmatively met.
 *   skills_gap  every hard requirement is met; a skill is missing. Acquirable.
 *   review      nothing is failed, but something cannot be confirmed — either
 *               the notification's wording or the profile's silence.
 *   blocked     exactly one stated requirement is definitely failed.
 */
export type MatchTier = "can_apply" | "skills_gap" | "review" | "blocked";

export interface TieredJob extends JobCard {
  tier: MatchTier;
  /** Ready to render — "Matches your sectors", "Closing soon". */
  reasons: string[];
  /** `kind:value` codes. `describeGap` in `lib/match/gaps.ts` renders them. */
  gaps: string[];
  /** Rows in this tier before the per-tier cap, so the counters are honest. */
  tier_total: number;
}

/**
 * The whole page, in one round trip.
 *
 * One call rather than the two `/for-you` used to make, and it returns the
 * counters as well as the rows — `tier_total` is a window function over rows
 * already scanned, not four more queries. Against the traffic model this is
 * roughly the same bytes as the pair it replaces and half the round trips.
 */
export async function listFeed(limit = 70): Promise<TieredJob[]> {
  const db = await sessionDb();

  const rows = unwrap("listFeed", await db.rpc("match_feed", { p_limit: limit }));

  return rows as unknown as TieredJob[];
}
