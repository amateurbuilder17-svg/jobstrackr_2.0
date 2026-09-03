import { type NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

import { adminDb } from "@/lib/db/clients";
import { getServerEnv } from "@/lib/env.server";

/**
 * Daily housekeeping.
 *
 * `prune_operational_data()` has existed since migration 0017 and nothing has
 * ever called it. `sync_runs`, `sync_dead_letter` and `job_changes` gain rows on
 * every ingest and lose them never, against a 500 MB database ceiling — a slow
 * leak that shows up as a full disk months later, with no single change to
 * blame.
 *
 * This is one of the two cron slots Vercel Hobby allows, and daily granularity
 * is all it needs. Ingestion is not scheduled here: it runs from Apps Script
 * time-triggers, because a feed people rely on within the hour cannot be served
 * by a once-a-day cron (see REBUILD-PLAN §6).
 *
 * `close_expired_jobs()` is deliberately *not* called here — it already runs on
 * every ingest, where it belongs. A job whose deadline passed at midnight
 * should stop being listed at midnight, not at whatever hour this cron lands.
 *
 * `merge_duplicate_jobs()` runs here rather than from ingest for the same
 * reason as the vacuum note in 0017: ingest already has a job to do, and a
 * cross-source duplicate (the same posting scraped from an organisation's own
 * site and from an aggregator, see migration 0027) is a housekeeping concern,
 * not a per-row ingest decision.
 *
 * No `dynamic = "force-dynamic"` segment config: Cache Components rejects it,
 * and it would be redundant anyway — reading the Authorization header is itself
 * a dynamic access, so this handler never gets prerendered.
 */

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

  const db = adminDb();

  const { data, error } = await db.rpc("prune_operational_data");

  if (error) {
    console.error("[cron:prune] failed:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: jobsMerged, error: mergeError } = await db.rpc("merge_duplicate_jobs");

  if (mergeError) {
    // Reported, not thrown: retention already ran and its counts are worth
    // keeping even if the merge step fails on a given day.
    console.error("[cron:prune] merge_duplicate_jobs failed:", mergeError.message);
  }

  // Counts go in the response body rather than a log line: Vercel records the
  // cron's response, and this codebase logs only failures.
  const total = data.reduce((sum, row) => sum + row.rows_deleted, 0);

  return NextResponse.json({
    ok: true,
    total,
    tables: data,
    jobsMerged: mergeError ? null : jobsMerged,
  });
}
