import { revalidateTag } from "next/cache";
import { after, type NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { adminDb } from "@/lib/db/clients";
import { tags } from "@/lib/db/tags";
import { getServerEnv } from "@/lib/env.server";
import { ingestJobs, recordJobChanges } from "@/lib/sync/ingest";
import { ingestExamUpdates } from "@/lib/sync/updates";
import { runSeoWorker } from "@/lib/seo/worker";

/**
 * The ingestion worker.
 *
 * One endpoint, called by an Apps Script time-trigger rather than a Vercel
 * cron — Hobby cron jobs may only run once per day, which is not enough for a
 * feed that matters within the hour (see plan §6). (The old note here said
 * Hobby allowed two crons; Vercel raised that to 100 per project on every
 * plan. The count was never the binding constraint — the daily cadence is,
 * and it still rules this out.)
 *
 * Three properties it has to have, all of which the old pipeline lacked:
 *
 *   **Idempotent.** Running it twice over the same feed is indistinguishable
 *   from running it once. The diff in `ingestJobs` is what delivers this, not
 *   a lock.
 *
 *   **Resumable.** Rows are processed in a batch; a failure part-way leaves the
 *   rows already written committed, and the next run skips them as unchanged.
 *
 *   **Non-stalling.** One malformed row lands in `sync_dead_letter` and the
 *   batch continues. The old pipeline threw, the run died, and the remaining
 *   rows needed requeueing by hand.
 */

/**
 * The SEO worker rides on this request (see the `after` calls below), and
 * `after` runs inside this route's duration budget — so the budget is now this
 * route's concern rather than something to leave at the default.
 *
 * 60, not the 300s Hobby actually permits. A ceiling is not a reservation and
 * costs nothing unused, but it is also the only thing that turns "ingestion
 * wedged on a slow upstream" into an error instead of five minutes of billed
 * wall-clock time. Ingestion is a bounded batch and the SEO pass is bounded by
 * `RUN_BUDGET_MS` (8s); if this route ever needs a minute, something is wrong
 * and a 504 is the correct way to find out.
 */
export const maxDuration = 60;

const bodySchema = z.object({
  kind: z.enum(["jobs", "exam_updates"]).default("jobs"),
  // Bounded: this is one HTTP request against a serverless time limit, and a
  // feed that has grown past this should be paged rather than retried forever.
  rows: z.array(z.record(z.string(), z.unknown())).max(2000),
});

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  // Either secret is a legitimate caller: the Apps Script time-trigger holds
  // SHEETS_SYNC_SECRET, a Vercel cron holds CRON_SECRET. An earlier version
  // preferred one and fell back to the other, which meant that setting both —
  // the normal state — silently made one of the two callers unauthorised.
  //
  // Both comparisons always run. Short-circuiting on the first match would
  // leak, through timing, which secret a caller had guessed correctly.
  const candidates = [env.SHEETS_SYNC_SECRET, env.CRON_SECRET].filter(
    (s): s is string => typeof s === "string" && s.length > 0,
  );

  const authorised = candidates.reduce(
    (ok, expected) => secretMatches(provided, expected) || ok,
    false,
  );

  if (!provided || !authorised) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let parsed;
  try {
    parsed = bodySchema.safeParse(await request.json());
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid body", issues: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }

  const { kind, rows } = parsed.data;
  const db = adminDb();
  const startedAt = Date.now();

  // A run row is opened before any work, so a worker that dies mid-batch leaves
  // evidence rather than nothing. A run stuck in 'running' is itself the alert.
  const { data: run, error: runError } = await db
    .from("sync_runs")
    .insert({ kind, status: "running" })
    .select("id")
    .single();

  if (runError) {
    return NextResponse.json({ error: "could not open a sync run" }, { status: 500 });
  }

  try {
    if (kind === "exam_updates") {
      const result = await ingestExamUpdates(rows);

      if (result.failures.length > 0) {
        await db.from("sync_dead_letter").insert(
          result.failures.map((f) => ({
            sync_run_id: run.id,
            kind,
            source_key: f.sourceKey,
            payload: f.payload as never,
            error: f.error,
          })),
        );
      }

      // Attach new updates to the job they are about. This is the link the old
      // schema left unpopulated on 3,370 of 3,373 rows, which is why every job
      // page paid for a title-similarity scan instead of a foreign key.
      //
      // Logged and stepped over on failure: an unlinked update is still a
      // readable update, and the next run retries it — the function walks
      // `job_link_state = 'unresolved'`.
      let linked = 0;
      if (result.inserted + result.updated > 0) {
        const { data, error } = await db.rpc("resolve_update_job_links", { p_batch: 500 });
        if (error) console.error("[sync] resolve_update_job_links:", error.message);
        else linked = data[0]?.linked ?? 0;
      }

      await db
        .from("sync_runs")
        .update({
          status: result.failed > 0 ? "partial" : "succeeded",
          rows_seen: result.seen,
          rows_inserted: result.inserted,
          rows_updated: result.updated,
          rows_unchanged: result.unchanged,
          rows_failed: result.failed,
          finished_at: new Date().toISOString(),
          duration_ms: Date.now() - startedAt,
        })
        .eq("id", run.id);

      const wroteUpdates = result.inserted + result.updated;
      if (wroteUpdates > 0) {
        revalidateTag(tags.examUpdateList(), { expire: 0 });
        revalidateTag(tags.sitemap(), { expire: 0 });
        // An update that resolved onto a job changes that job's page too.
        if (linked > 0) revalidateTag(tags.jobList(), { expire: 0 });

        // Tell the search engines, after the response rather than before it.
        // The Apps Script trigger is waiting on this request and does not care
        // about the result; the worker owns its own failures and never throws.
        after(pushToSearchEngines);
      }

      return NextResponse.json({
        runId: run.id,
        ...summarise(result),
        detailsWritten: result.detailsWritten,
        linked,
        revalidated: wroteUpdates > 0,
      });
    }

    // Retire anything whose window shut
    //
    // This rides on the Apps Script trigger rather than a Vercel cron: a Hobby
    // cron can only fire once a day, and hourly is the cadence this needs — a
    // job should leave the feed within an hour of closing, not within a day. It is what makes `status = 'published'`
    // mean "still open", which is what the closing-soonest default sort on
    // /jobs relies on to show the next deadline rather than the oldest expired
    // one.
    //
    // A failure here is logged and stepped over rather than thrown: a stale
    // listing in the feed is a much smaller problem than a batch of new jobs
    // that never lands.
    let closed = 0;
    {
      const { data, error } = await db.rpc("close_expired_jobs");
      if (error) console.error("[sync] close_expired_jobs:", error.message);
      else closed = data;
    }

    const result = await ingestJobs(rows);

    // After the rows land, never before: `job_changes.job_id` references
    // `jobs`, and a change entry is worthless without its subject.
    const recorded = await recordJobChanges(result.changes, run.id);
    if (recorded.error) console.error("[sync] recordJobChanges:", recorded.error);

    if (result.failures.length > 0) {
      await db.from("sync_dead_letter").insert(
        result.failures.map((f) => ({
          sync_run_id: run.id,
          kind,
          source_key: f.sourceKey,
          payload: f.payload as never,
          error: f.error,
        })),
      );
    }

    await db
      .from("sync_runs")
      .update({
        status: result.failed > 0 ? "partial" : "succeeded",
        rows_seen: result.seen,
        rows_inserted: result.inserted,
        rows_updated: result.updated,
        rows_unchanged: result.unchanged,
        rows_failed: result.failed,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
      })
      .eq("id", run.id);

    // Only when something actually changed. Revalidating on every run would
    // throw away the whole cache daily for no reason — which is the cost this
    // module's diff exists to avoid, undone at the last step.
    const wrote = result.inserted + result.updated + closed;
    if (wrote > 0) {
      revalidateTag(tags.jobList(), { expire: 0 });
      revalidateTag(tags.sitemap(), { expire: 0 });
      after(pushToSearchEngines);
    }

    return NextResponse.json({
      runId: run.id,
      ...summarise(result),
      detailsWritten: result.detailsWritten,
      closed,
      changesRecorded: recorded.written,
      revalidated: wrote > 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await db
      .from("sync_runs")
      .update({
        status: "failed",
        error: message,
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startedAt,
      })
      .eq("id", run.id);

    return NextResponse.json({ runId: run.id, error: message }, { status: 500 });
  }
}

function summarise(result: {
  seen: number;
  inserted: number;
  updated: number;
  unchanged: number;
  failed: number;
}) {
  return {
    seen: result.seen,
    inserted: result.inserted,
    updated: result.updated,
    unchanged: result.unchanged,
    failed: result.failed,
  };
}

/**
 * Announce the changed URLs to IndexNow and to Google's Indexing API.
 *
 * Deliberately after the revalidation, and deliberately inside `after`. A
 * crawler arriving on the strength of this ping must find the *new* page, and
 * `revalidateTag` above is what makes that true; pinging first would invite a
 * fetch of the copy we are in the middle of replacing.
 *
 * Ordering within `after` is not something to rely on for correctness — the
 * callback runs once the response is sent, by which point the invalidations
 * have long since been applied synchronously above.
 */
async function pushToSearchEngines(): Promise<void> {
  const run = await runSeoWorker();

  // Failures only — the successful case is recorded in `seo_ping_log`, which
  // is where a question about whether push indexing is working should be asked
  // anyway. A log line per hourly run would be noise that says "still fine".
  // Written out rather than `Object.entries`, which erases the value type and
  // makes every field below an `any`.
  for (const [target, result] of [
    ["indexnow", run.indexnow],
    ["google", run.google],
  ] as const) {
    if (result.failed > 0 || (result.configured && result.note)) {
      console.error(`[seo] ${target}: ${result.note ?? `${String(result.failed)} failed`}`);
    }
  }
}
