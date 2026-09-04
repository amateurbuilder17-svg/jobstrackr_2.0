import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { fetchExamStatus } from "@/lib/ai/exam-status";
import { hasApiKeys } from "@/lib/ai/gemini";
import { adminDb } from "@/lib/db/clients";
import { saveStatusReport } from "@/lib/db/queries/exam-status";
import { deriveAttemptStatus, isConfident, type StatusReport } from "@/lib/exams/report";
import { getServerEnv } from "@/lib/env.server";

/**
 * The automatic half of the tracker's status.
 *
 * Refresh Status is a button, and a button is only pressed by someone already
 * worried enough to look. The exam whose admit card came out this morning is
 * the one nobody has opened yet. So once a day the most-tracked subjects get
 * refreshed without being asked, and because the cache is shared by subject,
 * one call updates the panel for everybody tracking that exam.
 *
 * Three things bound it, and all three are deliberate:
 *
 *   • **A small batch.** Free-tier Gemini quota is finite and so is the 60s a
 *     Hobby function gets. Six subjects, most-tracked first, is what fits with
 *     room for a slow one.
 *   • **A wall-clock deadline.** The loop stops at 45 seconds whatever it has
 *     got through, so a hanging call costs one subject rather than the run.
 *   • **Only subjects somebody tracks**, and only ones whose answer is stale.
 *     `stale_status_subjects` decides that in one indexed query — see 0023 for
 *     why it is a SQL function rather than a query here.
 *
 * A Vercel cron rather than a ride on ingest, because daily is the cadence
 * this wants — which is also the only cadence Hobby crons offer. Daily
 * is also all Hobby offers, which suits: exam schedules move on the scale of
 * days, and the button covers the hour somebody actually needs an answer.
 *
 * Scheduled `30 1 * * *` — 07:00 IST. Conducting bodies publish overnight and
 * into the early morning, so this lands after the night's releases and before
 * the commute, which is when the tracker is actually opened.
 */

export const maxDuration = 60;

/**
 * The honest capacity of this job, arrived at by running it.
 *
 * A refresh is not one call, it is up to two: the grounded attempt, and the
 * ungrounded retry when grounding is refused or times out. At a 30-second
 * per-attempt timeout that is a 60-second worst case for a single subject —
 * the whole of what Vercel Hobby allows the function.
 *
 * Measured: one subject whose grounded call was quota-refused and fell back
 * took 56 seconds on its own. Two subjects took 67s and would have been killed
 * mid-write in production.
 *
 * So the rule is: always do one, and start another only if a full worst case
 * still fits. In practice that is one subject a night, occasionally two when
 * the first answers quickly. That is small, and it is the truth — the button
 * carries the real load, and this exists so the most-tracked exam does not go
 * stale while nobody is looking at it.
 */
const WORST_CASE_PER_SUBJECT_MS = 60_000;

/** Leaves 5s of the 60 for the final writes to land. */
const BUDGET_MS = 55_000;

/** The ceiling on how many are even considered, not how many will run. */
const BATCH = 6;

/**
 * Stale after 20 hours rather than 24.
 *
 * The cron runs at a fixed time; a 24-hour window means a report refreshed by
 * hand an hour before the run is skipped for a whole further day. Twenty hours
 * makes a daily run actually daily.
 */
const STALE_AFTER = "20 hours";

function authorized(request: NextRequest): boolean {
  const expected = getServerEnv().CRON_SECRET;

  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Compared in
  // constant time for the same reason /api/sync does: a timing oracle on a
  // shared secret is still a timing oracle.
  const provided = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";

  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!(await hasApiKeys())) {
    // Not an error. A deployment with an empty key pool still serves every
    // page; this job simply has nothing to do, and a red cron in the dashboard
    // would be noise rather than information.
    return NextResponse.json({ ok: true, skipped: "no api key" });
  }

  const { data, error } = await adminDb().rpc("stale_status_subjects", {
    p_limit: BATCH,
    p_stale_after: STALE_AFTER,
  });

  if (error) {
    console.error(`[cron:exam-status] queue query failed: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const startedAt = Date.now();
  let refreshed = 0;
  let advanced = 0;
  let failed = 0;

  let attempted = 0;

  for (const subject of data) {
    // Always do the first one — refusing to start any work because a worst
    // case would not fit is the one outcome worse than being cut off.
    if (attempted > 0 && Date.now() - startedAt + WORST_CASE_PER_SUBJECT_MS > BUDGET_MS) break;
    attempted += 1;

    try {
      const result = await fetchExamStatus({
        key: subject.subject_key,
        label: subject.subject_label,
        organization: subject.organization,
        officialWebsite: subject.official_website,
        // Nobody's personal stage applies to a shared answer.
        stage: null,
      });

      if (result === null) {
        failed += 1;
        continue;
      }

      await saveStatusReport({
        subjectKey: subject.subject_key,
        subjectLabel: subject.subject_label,
        examId: subject.exam_id,
        jobId: subject.job_id,
        report: result.report,
        sources: result.sources,
        grounded: result.grounded,
        model: result.model,
        // Not read back first: one extra query per subject to keep a tally
        // exact is not worth it, and the count restarting is visible nowhere.
        previousCount: 0,
      });

      refreshed += 1;
      advanced += await advanceTrackers(subject.exam_id, subject.job_id, result.report);
    } catch (cause) {
      // One subject failing must not end the run — the next one may be the one
      // whose admit card came out.
      failed += 1;
      console.error(`[cron:exam-status] ${subject.subject_key}:`, cause);
    }
  }

  if (refreshed > 0) revalidatePath("/tracker");

  return NextResponse.json({
    ok: true,
    queued: data.length,
    refreshed,
    advanced,
    failed,
    ms: Date.now() - startedAt,
  });
}

/**
 * Move everyone's row on, where the report warrants it.
 *
 * The same rule as the manual refresh — see `deriveAttemptStatus`: forward
 * only, "Admit card out" only, and never over a status its owner chose. The
 * difference is that this runs with the admin client, across other people's
 * rows, which is why the filters are written out rather than left to RLS.
 * There is no session here for RLS to scope to.
 *
 * Returns how many rows moved, for the run's own log line.
 */
async function advanceTrackers(
  examId: string | null,
  jobId: string | null,
  report: StatusReport,
): Promise<number> {
  if (!isConfident(report.confidence)) return 0;

  // `tracking` and `applied` are the only statuses the derivation will move,
  // and asking it rather than reimplementing the rule keeps the two paths from
  // drifting apart.
  const next = deriveAttemptStatus(report, "tracking", report.confidence);
  if (next === null) return 0;

  const db = adminDb();
  const column = examId !== null ? "exam_id" : "job_id";
  const value = examId ?? jobId;
  if (value === null) return 0;

  const { data, error } = await db
    .from("exam_attempts")
    .update({ status: next })
    .eq(column, value)
    .in("status", ["tracking", "applied"])
    .select("id");

  if (error) {
    console.warn(`[cron:exam-status] could not advance ${column}=${value}: ${error.message}`);
    return 0;
  }

  // Dates are filled only where the row has none, in separate statements
  // because "only if null" is a filter rather than a value — and only on
  // attempts their owner has not closed, matching the queue's own filter.
  const open = "(passed,failed,withdrawn)";
  const first = report.phases[0];

  if (first?.examDate) {
    await db
      .from("exam_attempts")
      .update({ exam_date: first.examDate })
      .eq(column, value)
      .is("exam_date", null)
      .not("status", "in", open);
  }

  if (first?.resultDate) {
    await db
      .from("exam_attempts")
      .update({ result_date: first.resultDate })
      .eq(column, value)
      .is("result_date", null)
      .not("status", "in", open);
  }

  return data.length;
}
