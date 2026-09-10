import { type NextRequest, NextResponse } from "next/server";

import { DEFAULT_THRESHOLD_MINUTES, ingestFreshness } from "@/lib/sync/freshness";

/**
 * Whether ingestion is still happening, in a form anything can read.
 *
 * ## Why the status code carries the answer
 *
 * The verdict is the HTTP status — 200 healthy, 503 not — because that is the
 * one thing every monitor already understands. A free uptime checker pointed at
 * this URL becomes a watchdog with no code and no credentials, and, crucially,
 * one that runs on somebody else's infrastructure.
 *
 * That last part is the point. The primary schedule is a GitHub Actions cron,
 * so a watchdog living in GitHub Actions dies in the same breath as the thing it
 * watches — and GitHub disables scheduled workflows silently after 60 days of
 * repository inactivity, which is exactly the failure worth being told about.
 * Detection has to be able to outlive the scheduler.
 *
 * ## Why it is not authenticated
 *
 * It answers one question and exposes one fact: how long ago ingestion last
 * succeeded. That is already visible to anyone watching whether the site's
 * listings change. Requiring a secret would buy nothing and would rule out the
 * external monitors that make this useful.
 */

// No `dynamic = "force-dynamic"` segment config: Cache Components rejects it,
// as `/api/sync` already records. It would be redundant anyway — reading
// `searchParams` below is itself a dynamic access, so this never gets
// prerendered, and `Cache-Control: no-store` is what keeps the CDN from
// answering with a 200 from before the outage.
export async function GET(request: NextRequest): Promise<NextResponse> {
  // A monitor with a different opinion about what counts as stale can say so,
  // within reason: ?thresholdMinutes=60 for a tighter alarm.
  const asked = Number(request.nextUrl.searchParams.get("thresholdMinutes"));
  const threshold =
    Number.isFinite(asked) && asked >= 5 && asked <= 10_080 ? asked : DEFAULT_THRESHOLD_MINUTES;

  const freshness = await ingestFreshness(threshold);

  return NextResponse.json(freshness, {
    // `unknown` fails too: a check that cannot see is not a check that passed.
    status: freshness.status === "ok" ? 200 : 503,
    headers: {
      // Never cached, at any layer. A cached health check is a health check
      // that reports the past — and the CDN would happily serve a 200 from
      // before the outage for the whole of it.
      "Cache-Control": "no-store, no-cache, must-revalidate",
    },
  });
}
