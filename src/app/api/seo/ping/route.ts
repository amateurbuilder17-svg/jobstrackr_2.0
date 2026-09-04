import { type NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { getServerEnv } from "@/lib/env.server";
import { runSeoWorker } from "@/lib/seo/worker";

/**
 * Manual push-indexing run.
 *
 * Not a cron — a Hobby cron fires once a day, which is why the worker rides on
 * `/api/sync` and its hourly trigger instead. This is the lever for the cases
 * that are not "an hour has passed":
 *
 *   - the first run after configuring a target, to start the backfill without
 *     waiting for the next ingest;
 *   - draining a backlog, since each call submits one batch;
 *   - checking that credentials work, because the response body is the run
 *     result rather than a log line nobody will read.
 *
 * Authenticated with `CRON_SECRET` for the same reason `/api/revalidate` is:
 * an unauthenticated endpoint that makes outbound API calls on the site's
 * behalf is a way to burn someone else's quota.
 */

export const maxDuration = 60;

function authorized(request: NextRequest): boolean {
  const expected = getServerEnv().CRON_SECRET;
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

  // A longer budget than the ingest-borne run gets: this request exists only to
  // do this, so there is no other work it can starve.
  return NextResponse.json(await runSeoWorker(Date.now() + 45_000));
}
