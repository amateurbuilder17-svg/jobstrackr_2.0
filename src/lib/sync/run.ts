import "server-only";

import { adminDb } from "@/lib/db/clients";
import { ingestJobs, recordJobChanges } from "./ingest";
import { ingestExamUpdates } from "./updates";

export type FeedRow = Record<string, unknown>;
export type SyncKind = "jobs" | "exam_updates";

/**
 * The ingest orchestration both entry points share.
 *
 * `POST /api/sync` is handed its rows by a caller; `GET /api/ingest` fetches
 * its own. Everything between "here are some rows" and "the run row is closed"
 * is identical, and duplicating it would produce two ingest paths that agree
 * today and diverge the first time one of them is fixed — the same reasoning
 * that put `uniqueSlugs` in one place.
 */

export interface BatchOutcome {
  seen: number;
  inserted: number;
  updated: number;
  unchanged: number;
  failed: number;
  detailsWritten: number;
  /** jobs only */
  changesRecorded: number;
  /** exam_updates only */
  linked: number;
}

export const emptyOutcome = (): BatchOutcome => ({
  seen: 0,
  inserted: 0,
  updated: 0,
  unchanged: 0,
  failed: 0,
  detailsWritten: 0,
  changesRecorded: 0,
  linked: 0,
});

/** Chunks are summed, because a run is reported as one row however many it took. */
export const addOutcome = (a: BatchOutcome, b: BatchOutcome): BatchOutcome => ({
  seen: a.seen + b.seen,
  inserted: a.inserted + b.inserted,
  updated: a.updated + b.updated,
  unchanged: a.unchanged + b.unchanged,
  failed: a.failed + b.failed,
  detailsWritten: a.detailsWritten + b.detailsWritten,
  changesRecorded: a.changesRecorded + b.changesRecorded,
  linked: a.linked + b.linked,
});

/**
 * Opened before any work — including, in the pull path, before the feed is
 * fetched. This is the whole difference between an outage that leaves evidence
 * and one that leaves none: the push endpoint used to open its row only after
 * authorising and parsing, so a caller that never arrived, posted to the apex
 * host, or sent an over-size batch produced no row at all. Two multi-day
 * outages were invisible for exactly that reason.
 */
export async function openRun(kind: SyncKind): Promise<string | null> {
  const { data, error } = await adminDb()
    .from("sync_runs")
    .insert({ kind, status: "running" })
    .select("id")
    .single();

  if (error) {
    console.error("[sync] openRun:", error.message);
    return null;
  }

  return data.id;
}

/**
 * Recorded in `error` on a run that ran out of wall clock before it had
 * consumed its window.
 *
 * There is no column for "did this run finish its window", and adding one would
 * be a migration. `error` is free text that nothing parses, so the marker lives
 * there — and `bookmarkFor` skips any run carrying it, which is what stops a
 * half-processed window from being treated as fully caught up. Without that,
 * the rows a cut-short run never reached would be skipped permanently.
 */
export const INCOMPLETE = "incomplete: ran out of time before the window was consumed";

export async function finishRun(
  runId: string,
  outcome: BatchOutcome,
  startedAt: number,
  incomplete = false,
): Promise<void> {
  const { error } = await adminDb()
    .from("sync_runs")
    .update({
      status: outcome.failed > 0 || incomplete ? "partial" : "succeeded",
      rows_seen: outcome.seen,
      rows_inserted: outcome.inserted,
      rows_updated: outcome.updated,
      rows_unchanged: outcome.unchanged,
      rows_failed: outcome.failed,
      error: incomplete ? INCOMPLETE : null,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
    })
    .eq("id", runId);

  if (error) console.error("[sync] finishRun:", error.message);
}

export async function failRun(
  runId: string,
  message: string,
  startedAt: number,
): Promise<void> {
  const { error } = await adminDb()
    .from("sync_runs")
    .update({
      status: "failed",
      error: message,
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
    })
    .eq("id", runId);

  if (error) console.error("[sync] failRun:", error.message);
}

/**
 * Retire anything whose window shut. Once per request, not once per chunk — it
 * is a sweep over the table, and running it five times in one run would cost
 * five scans to find nothing the first sweep left behind.
 */
export async function closeExpiredJobs(): Promise<number> {
  const { data, error } = await adminDb().rpc("close_expired_jobs");
  if (error) {
    // A stale listing in the feed is a much smaller problem than a batch of new
    // jobs that never lands.
    console.error("[sync] close_expired_jobs:", error.message);
    return 0;
  }
  return data;
}

/** The counts every ingest path reports, whatever it ingested. */
interface Counts {
  seen: number;
  inserted: number;
  updated: number;
  unchanged: number;
  failed: number;
  detailsWritten: number;
  failures: { sourceKey: string | null; error: string; payload: FeedRow }[];
}

/** One batch of one kind, with its failures recorded against `runId`. */
export async function ingestBatch(
  kind: SyncKind,
  rows: FeedRow[],
  runId: string,
): Promise<BatchOutcome> {
  const db = adminDb();
  const outcome = emptyOutcome();

  // Branched on `kind` rather than narrowed from a union: only the jobs result
  // carries `changes`, and `in`-narrowing a union whose members differ by one
  // optional-looking property widens it to `unknown`.
  let counts: Counts;

  if (kind === "jobs") {
    const result = await ingestJobs(rows);
    counts = result;

    // After the rows land, never before: `job_changes.job_id` references
    // `jobs`, and a change entry is worthless without its subject.
    const recorded = await recordJobChanges(result.changes, runId);
    if (recorded.error) console.error("[sync] recordJobChanges:", recorded.error);
    outcome.changesRecorded = recorded.written;
  } else {
    counts = await ingestExamUpdates(rows);
  }

  outcome.seen = counts.seen;
  outcome.inserted = counts.inserted;
  outcome.updated = counts.updated;
  outcome.unchanged = counts.unchanged;
  outcome.failed = counts.failed;
  outcome.detailsWritten = counts.detailsWritten;

  if (counts.failures.length > 0) {
    const { error } = await db.from("sync_dead_letter").insert(
      counts.failures.map((f) => ({
        sync_run_id: runId,
        kind,
        source_key: f.sourceKey,
        payload: f.payload as never,
        error: f.error,
      })),
    );
    if (error) console.error("[sync] sync_dead_letter:", error.message);
  }

  if (kind === "exam_updates" && outcome.inserted + outcome.updated > 0) {
    // Attach new updates to the job they are about — the link the old schema
    // left unpopulated on 3,370 of 3,373 rows.
    //
    // Logged and stepped over on failure: an unlinked update is still a
    // readable update, and the next run retries it.
    const { data, error } = await db.rpc("resolve_update_job_links", { p_batch: 500 });
    if (error) console.error("[sync] resolve_update_job_links:", error.message);
    else outcome.linked = data[0]?.linked ?? 0;
  }

  return outcome;
}

/** How long a run may sit in 'running' before it is assumed dead. */
const STALE_RUN_MS = 5 * 60_000;

export interface SlotClaim {
  ok: boolean;
  /** When the run that is already in flight started, if one is. */
  busySince?: string;
  /** Runs found abandoned in 'running' and marked failed. */
  reaped: number;
}

/**
 * A damper on overlapping schedulers — not a mutex, and not sold as one.
 *
 * Two schedulers can fire close enough together to both read "nothing running"
 * before either has written its row. A real lock would need an advisory lock
 * held across the request or a unique partial index, and both are schema
 * changes. This is worth having anyway because the cost it prevents is a
 * wasted 15-second feed fetch, not a correctness problem: ingestion is
 * idempotent by content hash, so the loser of a race writes nothing.
 *
 * The reap matters as much as the claim. A worker killed mid-run leaves its row
 * in 'running' forever, and without this that row would block every later run
 * and sit in the admin console looking like an in-flight job.
 */
export async function claimIngestSlot(): Promise<SlotClaim> {
  const db = adminDb();
  const cutoff = new Date(Date.now() - STALE_RUN_MS).toISOString();

  const { data: stale, error: reapError } = await db
    .from("sync_runs")
    .update({
      status: "failed",
      error: "reaped: left running by a worker that did not finish",
      finished_at: new Date().toISOString(),
    })
    .eq("status", "running")
    .lt("started_at", cutoff)
    .select("id");

  if (reapError) console.error("[sync] reap:", reapError.message);

  const { data: busy, error } = await db
    .from("sync_runs")
    .select("started_at")
    .eq("status", "running")
    .gte("started_at", cutoff)
    .order("started_at", { ascending: false })
    .limit(1);

  if (error) {
    // Unreadable state is not a reason to refuse to ingest. The worst case is
    // a duplicated run, which the diff makes cheap.
    console.error("[sync] claimIngestSlot:", error.message);
    return { ok: true, reaped: stale?.length ?? 0 };
  }

  const inFlight = busy[0];
  if (inFlight) {
    return { ok: false, busySince: inFlight.started_at, reaped: stale?.length ?? 0 };
  }

  return { ok: true, reaped: stale?.length ?? 0 };
}

/** Overlap re-read on every run, so a row written during the last one is not missed. */
const OVERLAP_MS = 30 * 60_000;

/** The furthest back a single run will ever reach. */
const MAX_WINDOW_MS = 7 * 24 * 60 * 60_000;

/**
 * Where this kind should resume from.
 *
 * The bookmark is what makes the pipeline self-healing: a window nobody
 * processed is simply included in the next one, so an outage of any length
 * repairs itself on the next fire of any scheduler rather than needing a person
 * and a recovery script. Both previous outages needed both.
 *
 * Runs marked `INCOMPLETE` are skipped, because their window was not consumed
 * and treating them as caught up would skip the rows they never reached. The
 * seven-day clamp is what stops that from becoming a window that grows without
 * bound — past it, the weekly reconcile is the backstop.
 */
export async function bookmarkFor(kind: SyncKind): Promise<string> {
  const floor = Date.now() - MAX_WINDOW_MS;

  const { data, error } = await adminDb()
    .from("sync_runs")
    .select("started_at, error")
    .eq("kind", kind)
    .in("status", ["succeeded", "partial"])
    .order("started_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("[sync] bookmarkFor:", error.message);
    return new Date(floor).toISOString();
  }

  const complete = data.find((row) => row.error !== INCOMPLETE);
  if (!complete) return new Date(floor).toISOString();

  const resume = new Date(complete.started_at).getTime() - OVERLAP_MS;

  return new Date(Math.max(resume, floor)).toISOString();
}
