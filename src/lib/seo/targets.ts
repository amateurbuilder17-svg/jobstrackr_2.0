import "server-only";

import { isUpdateIndexable } from "./indexing";

/**
 * The push-indexing targets, and what each one is allowed to be told.
 *
 * Everything in this file is a policy decision rather than a mechanism, which
 * is why it is separate from the two clients that implement them. Getting these
 * wrong is not a bug that shows up as an error — it is a bug that shows up as
 * an endpoint quietly withdrawing access weeks later.
 */

/** What a URL is, which decides which targets may receive it. */
export type SeoEntity = "job" | "update";

export interface SeoUrl {
  url: string;
  entity: SeoEntity;
  /** The row's `updated_at`, ISO. This is what advances the watermark. */
  updatedAt: string;
}

export type SeoTarget = "indexnow" | "google";

/**
 * Job pages go to both targets. Update pages go to neither while they answer
 * `noindex`, which every one has since 25 Sep 2026 (`isUpdateIndexable`):
 * announcing a page that refuses the index spends a submission on nothing.
 *
 * IndexNow would take them if they asked to be indexed; it takes anything on
 * the host. Google's Indexing API would not, ever. Google sanctions it for
 * pages carrying `JobPosting` or `BroadcastEvent` structured data, and states
 * plainly that using it for anything else is grounds for revoking access.
 * `/jobs/*` carries `JobPosting` (see `job-jsonld.ts`); `/updates/*` carries an
 * article and is never submitted there, no matter how much we would like it
 * crawled.
 */
export function eligibleFor(target: SeoTarget, entity: SeoEntity): boolean {
  if (entity === "job") return true;
  return target === "indexnow" && isUpdateIndexable();
}

/**
 * Per-run caps.
 *
 * IndexNow's own limit is 10,000 URLs per request and it costs one HTTP call
 * whatever the count, so the cap here is about the size of the JSON body and
 * the first-run case — 5,000 existing job pages should trickle out over a few
 * hours rather than arriving as one 400 kB POST that a proxy may refuse.
 *
 * Google's is quota arithmetic. The project allowance is 200 notifications a
 * day; `GOOGLE_DAILY` leaves twenty in hand so that a manual submission from
 * Search Console, or a re-run after a failure, is not the request that gets
 * the 429. `GOOGLE_PER_RUN` then spreads that allowance across the day rather
 * than spending it in the first two hours — ingestion runs hourly, so eight
 * per run is roughly the daily budget divided by the runs that will ask for it,
 * and a genuine burst of new notifications simply drains over the next few
 * hours instead of being dropped.
 */
export const CAPS = {
  indexNowPerRun: 500,
  googlePerRun: 8,
  googleDaily: 180,
} as const;

/**
 * How far back Google's run may reach, however old its watermark.
 *
 * IndexNow can take the whole corpus in a few runs; Google takes 180 URLs a
 * day. Its watermark starts at the epoch, and the worker submits oldest first,
 * so an unbounded first run would spend some two weeks announcing listings
 * published months ago — every one of them already in the sitemap — while a
 * job posted today waited behind them. Measured on 25 Sep 2026: ~2,800
 * published jobs, ~16 days at the daily cap.
 *
 * So Google is told about the last two days of changes and nothing older. A
 * normal day changes well under the cap; a bulk backfill that does not is
 * announced for two days and then left to the sitemap, which is where the
 * older half of any backlog was going to be found anyway.
 */
export const GOOGLE_LOOKBACK_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * How long the worker may spend before giving up and leaving the rest for the
 * next run.
 *
 * It runs in `after()` on the ingest request, so it shares that function's
 * duration budget. Bounding it here means a slow or hanging endpoint costs a
 * few seconds of an invocation that was going to happen anyway, rather than
 * timing out the request that writes the jobs — and because the watermark only
 * advances over URLs actually submitted, "gave up early" and "ran fine" have
 * the same recovery: the next run picks up where this one stopped.
 */
export const RUN_BUDGET_MS = 8_000;

/** Per-request timeout for a single outbound call to an indexing endpoint. */
export const REQUEST_TIMEOUT_MS = 5_000;
