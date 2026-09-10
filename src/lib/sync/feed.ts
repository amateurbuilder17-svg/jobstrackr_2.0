import "server-only";

import { z } from "zod";

import { getServerEnv } from "@/lib/env.server";
import type { FeedRow } from "./run";

/**
 * Reading the sheet, rather than waiting to be handed it.
 *
 * The Apps Script web app accepts `?since=`, and that one parameter is what
 * makes a pull path affordable. Measured against the live feed on 2026-09-09:
 *
 *   | since        | payload  | time |
 *   | ------------ | -------- | ---- |
 *   | (none)       | 85.4 MB  | 41 s |
 *   | 2 days       |  2.54 MB | 13 s |
 *   | 1 day        |  1.33 MB | 15 s |
 *
 * A half-hourly window is a handful of rows, so the cost is dominated by the
 * fifteen seconds Apps Script spends building the sheet rather than by the
 * transfer. That fits a function budget; the unfiltered feed does not, which is
 * why ingestion was push-only in the first place.
 */

/**
 * No retry, deliberately.
 *
 * `guardedFetch` would give two, and both would be wrong here: the upstream
 * takes 15–40 seconds to answer at all, so a second attempt cannot finish
 * inside the request budget. Retrying would convert "one slow run" into "a
 * guaranteed timeout with nothing written". A missed run is the cheap failure —
 * the bookmark means the next one covers this window too.
 */
const envelope = z.object({
  ok: z.boolean().optional(),
  error: z.string().optional(),
  jobs: z.array(z.record(z.string(), z.unknown())).optional(),
  updates: z.array(z.record(z.string(), z.unknown())).optional(),
});

export interface Feed {
  jobs: FeedRow[];
  updates: FeedRow[];
}

export class FeedUnavailable extends Error {}

/**
 * Fetch every row the sheet has gained since `since`.
 *
 * Redirects are followed: an Apps Script web app answers with a 302 to
 * `script.googleusercontent.com`, and the credential is in the query string
 * rather than a header, so it survives the hop. (The opposite is true of
 * `/api/sync` — see the apex-host note in `push-sheet-backlog.mjs`.)
 */
export async function fetchFeed(since: string, timeoutMs: number): Promise<Feed> {
  const env = getServerEnv();

  if (!env.APPS_SCRIPT_WEBAPP_URL || !env.SHEETS_SYNC_SECRET) {
    throw new FeedUnavailable("APPS_SCRIPT_WEBAPP_URL or SHEETS_SYNC_SECRET is not configured");
  }

  const url = new URL(env.APPS_SCRIPT_WEBAPP_URL);
  url.searchParams.set("secret", env.SHEETS_SYNC_SECRET);
  url.searchParams.set("since", since);

  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      // The sheet is rebuilt per request upstream; a cached copy would defeat
      // the point of asking for a window at all.
      cache: "no-store",
    });
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new FeedUnavailable(`feed request failed: ${reason}`);
  }

  if (!response.ok) {
    throw new FeedUnavailable(`feed responded ${String(response.status)}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new FeedUnavailable("feed did not return JSON");
  }

  const parsed = envelope.safeParse(body);
  if (!parsed.success) {
    throw new FeedUnavailable("feed returned an unrecognised shape");
  }

  // The web app reports its own failures in the body with a 200, so the status
  // code alone does not say whether this is data.
  if (parsed.data.ok === false) {
    throw new FeedUnavailable(`feed error: ${parsed.data.error ?? "unspecified"}`);
  }

  return {
    jobs: parsed.data.jobs ?? [],
    updates: parsed.data.updates ?? [],
  };
}
