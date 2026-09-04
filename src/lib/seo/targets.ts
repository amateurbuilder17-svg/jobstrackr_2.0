import "server-only";

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
 * IndexNow takes anything on the host, so both entities go.
 *
 * Google's Indexing API does not. Google sanctions it for pages carrying
 * `JobPosting` or `BroadcastEvent` structured data, and states plainly that
 * using it for anything else is grounds for revoking access. `/jobs/*` carries
 * `JobPosting` (see `job-jsonld.ts`); `/updates/*` carries an article and is
 * therefore never submitted, no matter how much we would like it crawled. It
 * reaches Google through the sitemap, which is the sanctioned route for it.
 */
export function eligibleFor(target: SeoTarget, entity: SeoEntity): boolean {
  if (target === "indexnow") return true;
  return entity === "job";
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
