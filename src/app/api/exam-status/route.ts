import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { z } from "zod";

import { fetchExamStatus, type StatusSubject } from "@/lib/ai/exam-status";
import { GeminiError, hasApiKeys } from "@/lib/ai/gemini";
import { getUser } from "@/lib/auth/session";
import { sessionDb } from "@/lib/db/clients";
import { getAttemptSubject, type AttemptSubject } from "@/lib/db/queries/attempts";
import { getStatusReport, saveStatusReport } from "@/lib/db/queries/exam-status";
import {
  deriveAttemptDates,
  deriveAttemptStatus,
  isStale,
  type ExamStatusReport,
  type StatusReport,
} from "@/lib/exams/report";
import { subjectColumnsFor, subjectKeyFor } from "@/lib/exams/subject";
import { consume, LIMITS } from "@/lib/rate-limit";
import type { AttemptStatus } from "@/lib/tracker/enums";

/**
 * Refresh Status.
 *
 * The old app's most-used control on the tracker, rebuilt. What it does, in
 * order, and why each step is where it is:
 *
 *   1. **Who is asking.** Verified against the auth server, not read from a
 *      cookie.
 *   2. **Two rate limits.** The in-process bucket refuses a double-tap without
 *      touching anything; the database quota is the actual ceiling, because
 *      the in-process one is per-instance and a model call costs real money.
 *   3. **Does this person own the attempt.** Read through the session client,
 *      so RLS answers rather than a `where user_id =` this code could forget.
 *   4. **Is the cached answer still good.** A shared cache: refreshing SSC CGL
 *      answers it for everyone tracking SSC CGL. This is the step that makes
 *      the feature affordable at all.
 *   5. **Ask the model**, grounded in Google Search.
 *   6. **Store it, and move the row on** if what came back warrants it.
 *
 * A route handler rather than a Server Action because of step 5: a grounded
 * call takes ten to twenty seconds, which needs a `maxDuration` this file can
 * declare and an action cannot. Keeping it here also leaves the tracker page's
 * own function untouched by the slowest thing in the app.
 */

/** A grounded search-then-generate is slow. Vercel Hobby allows 60s; take it. */
export const maxDuration = 60;

/**
 * Ten model calls a day, per person.
 *
 * The same number the old app settled on, and it settled there for a good
 * reason: nobody legitimately needs an eleventh look at whether their admit
 * card is out, and the shared cache means most looks cost nothing anyway. It
 * is a spend ceiling, not a usage target.
 */
const DAILY_LIMIT = 10;

/**
 * Half a minute between calls.
 *
 * Matches the cooldown the button shows, so the UI never promises a refresh
 * the server will refuse. Charged before the quota is spent — a refusal must
 * not consume a day's allowance.
 */
const COOLDOWN_SECONDS = 30;

/**
 * The floor under a shared answer, which even Refresh does not go below.
 *
 * Two people tracking SSC CGL press Refresh a minute apart. The second call
 * would cost quota and return the same sentences, because no conducting body
 * publishes twice in a quarter of an hour. So a report younger than this is
 * handed back as it is, whoever asked for it and however hard they pressed.
 *
 * This is the whole economics of a per-subject cache. Without it the cache
 * saves nothing at the only moment it could: the moment somebody asks.
 */
const MIN_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

const bodySchema = z.object({
  attemptId: z.uuid(),
  /** Skips the freshness check. Still costs quota; still refuses on cooldown. */
  force: z.boolean().default(false),
});

type Failure =
  | "unauthenticated"
  | "invalid"
  | "not_found"
  | "unconfigured"
  | "rate_limited"
  | "quota"
  | "unavailable"
  | "unreadable";

function fail(reason: Failure, message: string, status: number, retryAfter?: number) {
  return NextResponse.json(
    { ok: false, reason, message, ...(retryAfter === undefined ? {} : { retryAfter }) },
    {
      status,
      headers: {
        "Cache-Control": "private, no-store",
        ...(retryAfter === undefined ? {} : { "Retry-After": String(retryAfter) }),
      },
    },
  );
}

/** What to tell the model this attempt is about. */
function describe(attempt: AttemptSubject, key: string): StatusSubject {
  const label = attempt.exam?.name ?? attempt.job?.title ?? attempt.custom_name ?? "";

  return {
    key,
    label,
    organization: attempt.exam?.organization?.name ?? attempt.job?.organization?.name ?? null,
    officialWebsite: attempt.exam?.official_website ?? attempt.job?.source_url ?? null,
    stage: attempt.stage,
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getUser();
  if (!user) {
    return fail("unauthenticated", "Sign in to refresh exam status.", 401);
  }

  if (!(await hasApiKeys())) {
    // Deployed with an empty pool — no rows in `api_keys_config` and no
    // environment fallback. Says so plainly rather than reporting a model
    // failure, because those are fixed in completely different places.
    return fail("unconfigured", "Status refresh is not configured on this deployment.", 503);
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail("invalid", "That is not a valid request.", 400);
  }

  // First gate, and the cheapest: a held-down button never reaches Postgres.
  if (!consume(`ai:${user.id}`, LIMITS.ai)) {
    return fail("rate_limited", "Too many refreshes at once. Try again in a minute.", 429, 60);
  }

  const attempt = await getAttemptSubject(parsed.data.attemptId);
  if (!attempt) {
    return fail("not_found", "That exam is not on your tracker.", 404);
  }

  const subjectKey = subjectKeyFor(attempt);
  if (subjectKey === null) {
    // Unreachable while `exam_attempts_has_subject` holds.
    return fail("invalid", "That attempt does not name an exam.", 400);
  }

  const subject = describe(attempt, subjectKey);
  const cached = await getStatusReport(subjectKey);

  // The shared cache, and the two reasons to answer from it. Someone else may
  // have refreshed this exam an hour ago, in which case this costs one indexed
  // lookup and no model call at all.
  if (cached) {
    const age = Date.now() - new Date(cached.refreshedAt).getTime();
    // NaN compares false, so an unreadable timestamp falls through to a call —
    // which is the safe direction.
    const tooRecent = age < MIN_REFRESH_INTERVAL_MS;
    const stillFresh = !isStale(cached.refreshedAt, cached.confidence);

    if (tooRecent || (!parsed.data.force && stillFresh)) {
      return NextResponse.json(
        { ok: true, cached: true, report: toPayload(cached) },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    }
  }

  const db = await sessionDb();

  // Second gate, and the real one: atomic, shared across instances, and only
  // reached when a model call is genuinely about to happen.
  const { data: quota, error: quotaError } = await db.rpc("claim_ai_quota", {
    p_kind: "exam_status",
    p_daily_limit: DAILY_LIMIT,
    p_cooldown_seconds: COOLDOWN_SECONDS,
  });

  if (quotaError) {
    console.error(`[exam-status] quota check failed: ${quotaError.message}`);
    return fail("unavailable", "Could not refresh just now. Try again shortly.", 503, 30);
  }

  const claim = quota[0];
  if (!claim?.allowed) {
    const wait = claim?.retry_after ?? COOLDOWN_SECONDS;
    // Under a minute means the cooldown; anything longer means the day's
    // allowance is gone, and those want different sentences.
    const message =
      wait <= 120
        ? `Just a moment — you can refresh again in ${String(wait)}s.`
        : `That is all ${String(DAILY_LIMIT)} refreshes for today. They reset at midnight.`;

    // A stale answer beats no answer when the only thing stopping a refresh is
    // quota, so the cached report goes back with the refusal.
    return NextResponse.json(
      {
        ok: false,
        reason: "quota",
        message,
        retryAfter: wait,
        ...(cached ? { report: toPayload(cached) } : {}),
      },
      {
        status: 429,
        headers: { "Cache-Control": "private, no-store", "Retry-After": String(wait) },
      },
    );
  }

  let refreshed;
  try {
    refreshed = await fetchExamStatus(subject);
  } catch (error) {
    const message =
      error instanceof GeminiError && error.exhausted
        ? "The status service is busy. Try again in a few minutes."
        : "Could not reach the status service. Try again shortly.";
    console.error(`[exam-status] ${subjectKey}:`, error);
    return fail("unavailable", message, 503, 120);
  }

  if (refreshed === null) {
    // A well-formed call whose answer could not be read. The quota is already
    // spent — there is no honest way to un-spend it — so say so rather than
    // letting the button look free.
    return fail("unreadable", "The status service returned something unusable.", 502);
  }

  const columns = subjectColumnsFor(attempt);

  await saveStatusReport({
    subjectKey,
    subjectLabel: subject.label,
    examId: columns.exam_id,
    jobId: columns.job_id,
    report: refreshed.report,
    sources: refreshed.sources,
    grounded: refreshed.grounded,
    model: refreshed.model,
    previousCount: cached?.refreshCount ?? 0,
  });

  await advanceAttempt(attempt, refreshed.report, refreshed.report.confidence);

  // The tracker renders these server-side, so the next navigation to it must
  // not come from a cached render of the old answer.
  revalidatePath("/tracker");

  const payload: ExamStatusReport = {
    subjectKey,
    subjectLabel: subject.label,
    report: refreshed.report,
    confidence: refreshed.report.confidence,
    model: refreshed.model,
    grounded: refreshed.grounded,
    sources: refreshed.sources,
    refreshedAt: new Date().toISOString(),
  };

  return NextResponse.json(
    {
      ok: true,
      cached: false,
      report: payload,
      quota: { used: claim.used, limit: DAILY_LIMIT, resetsAt: claim.resets_at },
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/** Strips the internal refresh counter before a report goes over the wire. */
function toPayload(cached: ExamStatusReport & { refreshCount: number }): ExamStatusReport {
  const { refreshCount: _count, ...payload } = cached;
  return payload;
}

/**
 * The automatic half of "automatic status updates".
 *
 * Everything conservative about this lives in `deriveAttemptStatus` and
 * `deriveAttemptDates` — forward only, blanks only, and nothing at all from a
 * low-confidence answer. What is left here is the write, through the session
 * client so RLS scopes it, and a deliberate decision not to care if it fails:
 * the person has their answer on screen either way, and a tracker row that did
 * not move itself is a smaller problem than a request that 500s after spending
 * quota successfully.
 */
async function advanceAttempt(
  attempt: AttemptSubject,
  report: StatusReport,
  confidence: number | null,
): Promise<void> {
  const status = deriveAttemptStatus(report, attempt.status as AttemptStatus, confidence);
  const dates = deriveAttemptDates(report, attempt, confidence);

  const patch = { ...(status ? { status } : {}), ...dates };
  if (Object.keys(patch).length === 0) return;

  const db = await sessionDb();
  const { error } = await db.from("exam_attempts").update(patch).eq("id", attempt.id);

  if (error) {
    console.warn(`[exam-status] could not advance attempt ${attempt.id}: ${error.message}`);
  }
}
