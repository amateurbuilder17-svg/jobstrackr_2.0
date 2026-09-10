import { revalidateTag } from "next/cache";
import { after, type NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { tags } from "@/lib/db/tags";
import { getServerEnv } from "@/lib/env.server";
import { pushToSearchEngines } from "@/lib/seo/worker";
import { drainDeadLetter } from "@/lib/sync/drain";
import { FeedUnavailable, fetchFeed } from "@/lib/sync/feed";
import { ingestJobs } from "@/lib/sync/ingest";
import { ingestExamUpdates } from "@/lib/sync/updates";
import {
  addOutcome,
  bookmarkFor,
  claimIngestSlot,
  closeExpiredJobs,
  emptyOutcome,
  failRun,
  finishRun,
  ingestBatch,
  openRun,
  type BatchOutcome,
  type FeedRow,
  type SyncKind,
} from "@/lib/sync/run";

/**
 * Ingestion that fetches its own data.
 *
 * ## Why this exists alongside `/api/sync`
 *
 * `/api/sync` is a push endpoint: something outside this repository has to
 * decide ingestion should happen and hand over the rows. That arrangement has
 * failed twice, and both times silently — the run row was opened only after a
 * request had arrived and parsed, so a caller that never fired left no trace
 * anywhere. The site simply stopped changing, for four days in August and five
 * in September.
 *
 * Inverting the direction fixes the class of problem rather than the instance:
 *
 *   **A scheduler becomes trivial.** One authenticated GET, no body, no batch
 *   size to get wrong, no 84 MB request to split. Schedulers are then
 *   interchangeable and can be run in parallel, which is what makes any single
 *   one of them dying survivable.
 *
 *   **Gaps close themselves.** The window comes from `bookmarkFor`, which reads
 *   the last run that actually consumed its window — so a window nobody
 *   processed is simply included in the next fetch. An outage of any length
 *   repairs itself on the next fire, instead of needing a person to notice and
 *   run a recovery script by hand.
 *
 *   **Absence leaves evidence.** The run row is opened *before* the feed is
 *   fetched, so a failed fetch is a `failed` row rather than silence.
 *
 * `/api/sync` stays: it is the entry point `push-sheet-backlog.mjs` uses for a
 * full reconcile, and a working manual escape hatch is worth keeping.
 */

export const maxDuration = 60;

/**
 * The wall clock, spent deliberately.
 *
 * Upstream needs 15–40 seconds to build the sheet before a byte arrives, so the
 * feed timeout is the dominant term and everything else is sized around what is
 * left. The ingest deadline sits well inside `maxDuration` because being killed
 * mid-write loses the run row's honesty: a run that stops on its own deadline
 * records what it did and says it was incomplete, and a run that is killed says
 * nothing at all.
 */
const FEED_TIMEOUT_MS = 30_000;
const INGEST_DEADLINE_MS = 48_000;

/** Matches what both ingest paths were tuned for, and what the backlog script sends. */
const CHUNK = 150;

function authorized(request: NextRequest, expected: string): boolean {
  const provided = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";

  // Constant time, for the same reason `/api/sync` and `/api/cron/prune` are:
  // a timing oracle on a shared secret is still a timing oracle.
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

interface ChunkedResult {
  outcome: BatchOutcome;
  incomplete: boolean;
}

/**
 * Feed one kind through the ingest path in bounded pieces.
 *
 * Stops on the deadline rather than on an error — a chunk that fails has
 * already recorded its rows in `sync_dead_letter` and the next chunk is
 * independent. What it will not do is keep starting chunks it cannot finish:
 * the rows already written stay written, the run is reported incomplete, and
 * `bookmarkFor` declines to advance past it so the remainder is picked up next
 * time rather than skipped.
 */
async function ingestChunks(
  kind: SyncKind,
  rows: FeedRow[],
  runId: string,
  deadline: number,
): Promise<ChunkedResult> {
  let outcome = emptyOutcome();

  for (let i = 0; i < rows.length; i += CHUNK) {
    if (Date.now() > deadline) return { outcome, incomplete: true };
    outcome = addOutcome(outcome, await ingestBatch(kind, rows.slice(i, i + CHUNK), runId));
  }

  return { outcome, incomplete: false };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const startedAt = Date.now();
  const env = getServerEnv();

  if (!authorized(request, env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Several schedulers point at this endpoint on purpose, so two firing close
  // together is expected rather than exceptional.
  const slot = await claimIngestSlot();
  if (!slot.ok) {
    return NextResponse.json(
      { skipped: "another run is in flight", busySince: slot.busySince, reaped: slot.reaped },
      { status: 409 },
    );
  }

  // One fetch serves both kinds, so the window is the earlier of the two
  // bookmarks. Over-fetching for one of them costs nothing: the content-hash
  // diff reads rows it has already seen as unchanged and writes none of them.
  const [jobsFrom, updatesFrom] = await Promise.all([
    bookmarkFor("jobs"),
    bookmarkFor("exam_updates"),
  ]);
  const since = jobsFrom < updatesFrom ? jobsFrom : updatesFrom;

  const jobsRun = await openRun("jobs");
  const updatesRun = await openRun("exam_updates");

  if (!jobsRun || !updatesRun) {
    if (jobsRun) await failRun(jobsRun, "could not open both run rows", startedAt);
    if (updatesRun) await failRun(updatesRun, "could not open both run rows", startedAt);
    return NextResponse.json({ error: "could not open a sync run" }, { status: 500 });
  }

  let feed;
  try {
    feed = await fetchFeed(since, FEED_TIMEOUT_MS);
  } catch (error) {
    const message =
      error instanceof FeedUnavailable
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);

    // Both rows are closed as failed. This is the case that used to be
    // invisible, and it is now a row in the table the watchdog reads.
    await failRun(jobsRun, message, startedAt);
    await failRun(updatesRun, message, startedAt);

    return NextResponse.json({ since, error: message }, { status: 502 });
  }

  try {
    const deadline = startedAt + INGEST_DEADLINE_MS;

    // Once per request, not once per chunk.
    const closed = await closeExpiredJobs();

    // Jobs first: a listing whose deadline is today matters more within the
    // hour than the notification about it. If the budget runs out before the
    // updates are done, neither bookmark advances past its window, so the next
    // run covers the remainder rather than skipping it.
    const jobs = await ingestChunks("jobs", feed.jobs, jobsRun, deadline);
    const updates = await ingestChunks("exam_updates", feed.updates, updatesRun, deadline);

    await finishRun(jobsRun, jobs.outcome, startedAt, jobs.incomplete);
    await finishRun(updatesRun, updates.outcome, startedAt, updates.incomplete);

    // Opportunistic repair, riding on a connection that is already open.
    const drainedJobs = await drainDeadLetter("jobs", ingestJobs);
    const drainedUpdates = await drainDeadLetter("exam_updates", ingestExamUpdates);

    const wroteJobs =
      jobs.outcome.inserted + jobs.outcome.updated + closed + drainedJobs.resolved;
    const wroteUpdates =
      updates.outcome.inserted + updates.outcome.updated + drainedUpdates.resolved;

    // Only what actually changed. Revalidating on every run would throw away
    // the whole cache every half hour for no reason — which is the cost the
    // content-hash diff exists to avoid, undone at the last step.
    if (wroteJobs > 0) revalidateTag(tags.jobList(), { expire: 0 });
    if (wroteUpdates > 0) {
      revalidateTag(tags.examUpdateList(), { expire: 0 });
      // An update that resolved onto a job changes that job's page too.
      if (updates.outcome.linked > 0) revalidateTag(tags.jobList(), { expire: 0 });
    }
    if (wroteJobs + wroteUpdates > 0) {
      revalidateTag(tags.sitemap(), { expire: 0 });
      after(pushToSearchEngines);
    }

    return NextResponse.json({
      since,
      reaped: slot.reaped,
      jobs: {
        runId: jobsRun,
        ...jobs.outcome,
        incomplete: jobs.incomplete,
        drained: drainedJobs,
      },
      exam_updates: {
        runId: updatesRun,
        ...updates.outcome,
        incomplete: updates.incomplete,
        drained: drainedUpdates,
      },
      closed,
      revalidated: wroteJobs + wroteUpdates > 0,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failRun(jobsRun, message, startedAt);
    await failRun(updatesRun, message, startedAt);
    return NextResponse.json({ since, error: message }, { status: 500 });
  }
}
