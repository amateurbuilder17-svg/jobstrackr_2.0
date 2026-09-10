import { type NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { getServerEnv } from "@/lib/env.server";
import { ingestFreshness } from "@/lib/sync/freshness";

/**
 * The alarm that does not share fate with the scheduler.
 *
 * Ingestion's primary schedule is a GitHub Actions cron, and that workflow also
 * asserts `/api/health/ingest` on every run — which catches a broken feed within
 * half an hour and is the fast path. What it cannot catch is GitHub itself: a
 * workflow disabled after 60 days of repository inactivity takes the watchdog
 * with it, silently, and that is the same shape as the Apps Script trigger whose
 * death went unnoticed for four days and then five.
 *
 * So this runs on Vercel's scheduler instead. Slower — once a day is all Hobby
 * offers — but it is the only detector that still works when the machinery
 * around ingestion has stopped, which is the exact circumstance an alarm is for.
 * Scheduled far from the ingest cron on purpose: run it just after and the
 * newest success is always minutes old, which would report health forever.
 *
 * It never repairs anything. A watchdog that tries to fix what it found is a
 * watchdog whose own failures are silent again.
 */

function authorized(request: NextRequest, expected: string): boolean {
  const provided = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Telegram, when it is configured.
 *
 * Never throws and never fails the route: an alarm that can 500 is an alarm
 * whose silence is ambiguous. If this cannot deliver, the run still answers 503
 * and the failure is on the record in Vercel's logs.
 */
async function shout(text: string): Promise<"sent" | "not configured" | "failed"> {
  const env = getServerEnv();
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_ALERT_CHAT_ID) return "not configured";

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: env.TELEGRAM_ALERT_CHAT_ID,
          text,
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!response.ok) {
      console.error("[watchdog] telegram responded", response.status);
      return "failed";
    }
    return "sent";
  } catch (error) {
    console.error(
      "[watchdog] telegram:",
      error instanceof Error ? error.message : String(error),
    );
    return "failed";
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const env = getServerEnv();

  if (!authorized(request, env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const freshness = await ingestFreshness();

  if (freshness.status === "ok") {
    // Deliberately silent. A daily "still fine" trains you to ignore the one
    // that matters, which is the failure mode of every alert that cries wolf.
    return NextResponse.json({ ...freshness, alerted: false });
  }

  const failures =
    freshness.consecutiveFailures > 0
      ? `\n${String(freshness.consecutiveFailures)} run(s) have failed since.`
      : "";

  const alerted = await shout(
    `Jobstrackr: ingestion has stopped.\n\n${freshness.detail}.${failures}\n\n` +
      `Last success: ${freshness.lastSuccessAt ?? "never"}\n` +
      `Check: https://www.jobstrackr.in/api/health/ingest\n` +
      `and the Ingest workflow in GitHub Actions.`,
  );

  console.error(`[watchdog] ${freshness.status}: ${freshness.detail} (telegram: ${alerted})`);

  // 503 so the failure is visible in Vercel's own cron history too, not only
  // wherever the message went.
  return NextResponse.json({ ...freshness, alerted }, { status: 503 });
}
