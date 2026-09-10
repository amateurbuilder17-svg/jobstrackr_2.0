import { revalidateTag } from "next/cache";
import { after, type NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { tags } from "@/lib/db/tags";
import { getServerEnv } from "@/lib/env.server";
import { pushToSearchEngines } from "@/lib/seo/worker";
import { drainDeadLetter } from "@/lib/sync/drain";
import { ingestJobs } from "@/lib/sync/ingest";
import { closeExpiredJobs, failRun, finishRun, ingestBatch, openRun } from "@/lib/sync/run";
import { ingestExamUpdates } from "@/lib/sync/updates";

/**
 * The ingestion worker.
 *
 * The *push* half of ingestion, and no longer the way it ordinarily happens.
 *
 * This endpoint was once the only way rows arrived: an Apps Script time-trigger
 * posted to it, because a Hobby cron fires once a day and the feed matters
 * within the hour. That arrangement failed twice — four days in August, five in
 * September — and both times silently, because nothing in this repository knew
 * ingestion was supposed to happen.
 *
 * `GET /api/ingest` replaced it by inverting the direction: the app fetches its
 * own window and schedules itself from callers that live in git. What remains
 * here is the manual path — `scripts/push-sheet-backlog.mjs` posts its full
 * reconcile through this endpoint, and a working escape hatch is worth keeping.
 * Both share one orchestration, in `src/lib/sync/run.ts`.
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
 *   **Non-stalling.** One bad row lands in `sync_dead_letter` and the batch
 *   continues. This was long claimed here and only half true: it held for a row
 *   rejected while being parsed, and not at all for one Postgres refused, which
 *   aborted the whole multi-row insert and threw. `insert-batch.ts` closes that
 *   gap by isolating the offender instead of predicting it.
 *
 *   **Self-repairing.** A dead letter is re-attempted on a later run rather
 *   than written and forgotten — `drain.ts`, bounded per run and capped per
 *   row. Without it every fix to a parse bug arrived too late for the rows that
 *   bug had already cost.
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
  // Either secret is a legitimate caller: the reconcile script holds
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
  const startedAt = Date.now();

  // Opened before any work, so a worker that dies mid-batch leaves evidence
  // rather than nothing. A run stuck in 'running' is itself the alert — and is
  // reaped by `claimIngestSlot` on the pull path.
  const runId = await openRun(kind);
  if (!runId) {
    return NextResponse.json({ error: "could not open a sync run" }, { status: 500 });
  }

  try {
    // Retire anything whose window shut, before the new rows land. This is what
    // makes `status = 'published'` mean "still open", which the closing-soonest
    // default sort on /jobs relies on.
    const closed = kind === "jobs" ? await closeExpiredJobs() : 0;

    // Everything from here is shared with `GET /api/ingest`; see `run.ts`.
    const outcome = await ingestBatch(kind, rows, runId);
    await finishRun(runId, outcome, startedAt);

    // Opportunistic repair, riding on a run that is already here and paying for
    // a connection. Bounded by its own limit and never fatal — see `drain.ts`.
    const drained = await drainDeadLetter(
      kind,
      kind === "jobs" ? ingestJobs : ingestExamUpdates,
    );

    const wrote = outcome.inserted + outcome.updated + closed + drained.resolved;

    // Only when something actually changed. Revalidating on every run would
    // throw away the whole cache for no reason — which is the cost the
    // content-hash diff exists to avoid, undone at the last step.
    if (wrote > 0) {
      if (kind === "jobs") {
        revalidateTag(tags.jobList(), { expire: 0 });
      } else {
        revalidateTag(tags.examUpdateList(), { expire: 0 });
        // An update that resolved onto a job changes that job's page too.
        if (outcome.linked > 0) revalidateTag(tags.jobList(), { expire: 0 });
      }

      revalidateTag(tags.sitemap(), { expire: 0 });

      // Tell the search engines, after the response rather than before it. The
      // caller is waiting on this request and does not care about the result;
      // the worker owns its own failures and never throws.
      after(pushToSearchEngines);
    }

    return NextResponse.json({
      runId,
      ...outcome,
      closed,
      drained,
      revalidated: wrote > 0,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failRun(runId, message, startedAt);
    return NextResponse.json({ runId, error: message }, { status: 500 });
  }
}
