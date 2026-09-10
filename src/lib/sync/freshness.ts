import "server-only";

import { adminDb } from "@/lib/db/clients";

/**
 * Is ingestion actually happening?
 *
 * ## The question nothing could answer
 *
 * Ingestion has stopped twice for multi-day stretches, and both times the way
 * it was discovered was somebody noticing the site had gone quiet. There was no
 * signal to check because there was nothing to check: `/api/sync` opened its run
 * row only after a request had arrived, so a caller that never fired left no
 * row, and an empty list looks exactly like a list nobody has looked at.
 *
 * Every other phase makes ingestion more likely to run. This is the one that
 * makes *not* running observable, and it is the only one that helps when the
 * others have failed — which is the case it exists for.
 *
 * ## Why success, not activity
 *
 * Freshness is measured from the newest run that actually ingested — `succeeded`
 * or `partial` — never from the newest row. A broken feed produces a steady
 * stream of `failed` rows, which is *activity*; treating that as health would
 * report a green light through exactly the outage this is meant to catch. The
 * failures are still counted and reported, because "twelve consecutive failures"
 * is a more useful thing to be told than "stale".
 */

/**
 * Three hours.
 *
 * The primary schedule is half-hourly and GitHub's cron drifts by ten to twenty
 * minutes under load, so anything under an hour would cry wolf. Three hours is
 * six missed fires — comfortably past coincidence, and still well inside the
 * four days that went unnoticed in August.
 */
export const DEFAULT_THRESHOLD_MINUTES = 180;

export interface Freshness {
  /** `unknown` means the question could not be answered, which is not the same as healthy. */
  status: "ok" | "stale" | "unknown";
  lastSuccessAt: string | null;
  ageMinutes: number | null;
  thresholdMinutes: number;
  /** Runs that failed after the last successful one. */
  consecutiveFailures: number;
  detail: string;
}

/** The shape both callers already have: a run's status and when it started. */
export interface RunLike {
  status: string;
  started_at: string;
}

/**
 * The verdict, given rows somebody already has.
 *
 * Split out from the query because the admin console has these rows in hand
 * from `listSyncRuns` and should not pay for a second read to be told something
 * they already answer — the same per-request-cost discipline the rest of the
 * app is built on.
 */
export function freshnessOf(
  rows: RunLike[],
  thresholdMinutes: number = DEFAULT_THRESHOLD_MINUTES,
): Freshness {
  const base = { thresholdMinutes, lastSuccessAt: null, ageMinutes: null };

  const succeeded = rows.findIndex((r) => r.status === "succeeded" || r.status === "partial");

  if (succeeded === -1) {
    return {
      ...base,
      status: "stale",
      consecutiveFailures: rows.filter((r) => r.status === "failed").length,
      detail:
        rows.length === 0
          ? "no ingest run has ever been recorded"
          : `no successful run in the last ${String(rows.length)} attempts`,
    };
  }

  const last = rows[succeeded];
  if (!last) {
    return { ...base, status: "unknown", consecutiveFailures: 0, detail: "unreadable run row" };
  }

  // Everything newer than the last success that failed outright.
  const consecutiveFailures = rows
    .slice(0, succeeded)
    .filter((r) => r.status === "failed").length;

  const ageMinutes = Math.round((Date.now() - new Date(last.started_at).getTime()) / 60_000);
  const stale = ageMinutes > thresholdMinutes;

  return {
    thresholdMinutes,
    lastSuccessAt: last.started_at,
    ageMinutes,
    status: stale ? "stale" : "ok",
    consecutiveFailures,
    detail: stale
      ? `last successful ingest was ${String(ageMinutes)} minutes ago, over the ${String(thresholdMinutes)} minute threshold`
      : `last successful ingest was ${String(ageMinutes)} minutes ago`,
  };
}

/** The same verdict, for callers that have to go and look. */
export async function ingestFreshness(
  thresholdMinutes: number = DEFAULT_THRESHOLD_MINUTES,
): Promise<Freshness> {
  const { data, error } = await adminDb()
    .from("sync_runs")
    .select("status, started_at")
    .in("kind", ["jobs", "exam_updates"])
    .order("started_at", { ascending: false })
    .limit(40);

  if (error) {
    // Not `ok`. A monitor that reports healthy when it cannot see is worse than
    // one that reports nothing, because it is believed.
    return {
      thresholdMinutes,
      lastSuccessAt: null,
      ageMinutes: null,
      status: "unknown",
      consecutiveFailures: 0,
      detail: `could not read sync_runs: ${error.message}`,
    };
  }

  return freshnessOf(data, thresholdMinutes);
}
