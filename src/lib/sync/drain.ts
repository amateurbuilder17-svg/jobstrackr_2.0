import "server-only";

import { adminDb } from "@/lib/db/clients";

export type FeedRow = Record<string, unknown>;

/**
 * Retrying what the database refused.
 *
 * ## Why a dead letter that is never read is not a dead letter
 *
 * `sync_dead_letter` has been written since Module 1 and read by nothing. The
 * route inserts into it, the admin console lists it, `prune_operational_data`
 * deletes from it — and no code path has ever re-attempted a row. `attempts`
 * has sat at its default of 1 on every row ever written, and `resolved_at` has
 * never been set.
 *
 * That is the difference between 114 recorded failures and 1,104 missing jobs.
 * A row that failed once was lost permanently, so every transient cause — a
 * conflicting row since removed, a parse bug since fixed, a column since
 * widened — became permanent data loss. The three fixes in `insert-batch.ts`
 * all landed *after* the rows they would have saved were already dead-lettered,
 * and not one of those rows came back.
 *
 * So the isolation in `insert-batch.ts` is only half the repair. Isolating a
 * bad row keeps the batch; draining the dead letter is what eventually gets the
 * bad row itself, once whatever refused it has been fixed.
 *
 * ## Bounds
 *
 * This rides on an ingest run that already has a wall clock to answer to, so it
 * takes a small slice: `limit` rows per run, oldest first. At the default of 25
 * and a half-hourly cadence that is 1,200 retries a day against a backlog of
 * 114 — cleared within one run of a fix landing, without ever being the reason
 * a run times out.
 *
 * `maxAttempts` is what stops a genuinely unfixable row from being retried
 * forever. Past the cap it stays unresolved and stops being offered: it is no
 * longer a retry candidate, it is a bug report, and it belongs in the admin
 * console where somebody can look at it. Nothing prunes unresolved rows, which
 * is deliberate — that list should stay visible until it is dealt with.
 */

export interface DrainResult {
  /** Rows handed back to the ingest path. */
  attempted: number;
  /** Rows that landed this time and are now marked resolved. */
  resolved: number;
  /** Rows the database refused again; their `attempts` has been incremented. */
  stillFailing: number;
}

/** Structurally satisfied by both `ingestJobs` and `ingestExamUpdates`. */
type IngestFn = (
  rows: FeedRow[],
) => Promise<{ failures: { error: string; payload: FeedRow }[] }>;

export interface DrainOptions {
  limit?: number;
  maxAttempts?: number;
}

const DEFAULT_LIMIT = 25;
const DEFAULT_MAX_ATTEMPTS = 5;

const isFeedRow = (value: unknown): value is FeedRow =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Re-attempt the oldest open dead letters for `kind` through `ingest`.
 *
 * Success is decided by object identity, not by matching `source_key`: the same
 * row objects that go into `ingest` come back out on `failures[].payload`, so
 * anything absent from that list landed. Matching on the key instead would
 * resolve the wrong row whenever two failures shared a source URL.
 *
 * Failures here are recorded against the existing dead-letter row rather than
 * inserted as new ones. A retry that fails must not grow the queue it is
 * draining — that is how a dead letter becomes a duplicate factory.
 */
export async function drainDeadLetter(
  kind: "jobs" | "exam_updates",
  ingest: IngestFn,
  options: DrainOptions = {},
): Promise<DrainResult> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  const empty: DrainResult = { attempted: 0, resolved: 0, stillFailing: 0 };
  if (limit <= 0) return empty;

  const db = adminDb();

  // Served by `sync_dead_letter_open_idx`, which is partial on
  // `resolved_at is null` and already ordered by (kind, created_at).
  const { data: open, error: readError } = await db
    .from("sync_dead_letter")
    .select("id, payload, attempts")
    .eq("kind", kind)
    .is("resolved_at", null)
    .lt("attempts", maxAttempts)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (readError) {
    // Never fatal. The drain is opportunistic repair riding on a run whose real
    // job is the new rows; failing that run because the repair could not start
    // would trade a working ingest for a broken one.
    console.error("[sync] drainDeadLetter read:", readError.message);
    return empty;
  }

  const candidates = open.flatMap((row) =>
    isFeedRow(row.payload)
      ? [{ id: row.id, attempts: row.attempts, payload: row.payload }]
      : [],
  );

  if (candidates.length === 0) return empty;

  const result = await ingest(candidates.map((c) => c.payload));

  const refused = new Set(result.failures.map((f) => f.payload));
  const errorFor = new Map(result.failures.map((f) => [f.payload, f.error]));

  const resolved = candidates.filter((c) => !refused.has(c.payload));
  const failed = candidates.filter((c) => refused.has(c.payload));

  if (resolved.length > 0) {
    const { error } = await db
      .from("sync_dead_letter")
      .update({ resolved_at: new Date().toISOString() })
      .in(
        "id",
        resolved.map((c) => c.id),
      );

    if (error) console.error("[sync] drainDeadLetter resolve:", error.message);
  }

  // One statement each: the rows differ in both `attempts` and `error`, and
  // there are at most `limit` of them.
  for (const c of failed) {
    const { error } = await db
      .from("sync_dead_letter")
      .update({ attempts: c.attempts + 1, error: errorFor.get(c.payload) ?? "refused again" })
      .eq("id", c.id);

    if (error) console.error("[sync] drainDeadLetter retry:", error.message);
  }

  return {
    attempted: candidates.length,
    resolved: resolved.length,
    stillFailing: failed.length,
  };
}
