import type { UpdateCategory } from "@/lib/updates/categories";

/**
 * Which detail pages ask to be indexed.
 *
 * One rule, read by three places that must agree: the page's robots meta, the
 * sitemap, and the push-indexing worker. A URL in the sitemap whose page says
 * `noindex` is a contradiction Search Console reports as an error, and a URL the
 * worker announces to Bing only to be refused is a wasted submission.
 *
 * ── Why the index is being made smaller ────────────────────────────────────
 * Measured on 22 Sep 2026: the sitemap listed 14,646 URLs and Google had
 * indexed about 270 of them. 15,828 sat in "Discovered – currently not
 * indexed" and 3,454 in "Crawled – currently not indexed". Google samples a
 * site, judges what it finds, and sets its crawl demand for the rest from that
 * judgement, so every weak page submitted lowers the odds for the strong ones.
 * Two groups made up most of the sample, and neither is a page worth ranking:
 *
 *   - **Closed listings, long after the deadline.** 4,667 of the 7,287 job
 *     URLs. A page whose first line is "applications have closed" is what
 *     Google files as a soft 404, and a recruitment nobody can apply to stops
 *     being searched for within weeks of its last date.
 *   - **Recruitment notices in the updates feed.** The `notification` category
 *     restates a job that already has its own, better page here — about 3,300
 *     of the 7,346 update URLs — in synonym-spun wording from the upstream feed
 *     ("register online" for "apply online"). Two pages on one site for one
 *     recruitment, one of them paraphrased, is the duplicate Google declines.
 *
 * Both stay published and both still answer 200. Links in WhatsApp forwards and
 * bookmarks keep working, the page keeps linking onward (`follow`), and the
 * job's own page is the one left to rank.
 */

/**
 * How long a closed listing keeps asking to be indexed after its last date.
 *
 * Interest in a recruitment does not stop on its deadline. The admit card,
 * the exam date and the result all send people back to the notice for weeks,
 * so a closed page is still worth a search result for a while. It is not
 * worth one for ever.
 */
export const CLOSED_JOB_INDEX_DAYS = 30;

/**
 * The oldest `last_date` a closed listing may carry and still be indexed.
 *
 * `today` is an IST calendar date (`todayInIndia()`), and the result is one too,
 * so the comparison is a string comparison. That is also how PostgREST receives
 * it in the sitemap query.
 */
export function closedJobIndexCutoff(today: string): string {
  const from = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  return new Date(from - CLOSED_JOB_INDEX_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Whether a job page asks to be indexed.
 *
 * Open listings always do. A closed one does until `CLOSED_JOB_INDEX_DAYS`
 * after its last date. A closed listing with no last date at all does not:
 * there is nothing to measure the window from, and `close_expired_jobs()`
 * closes by that date, so a closed row without one was closed by hand.
 */
export function isJobIndexable(
  job: { status: string; last_date: string | null },
  today: string,
): boolean {
  if (job.status !== "closed") return true;
  if (!job.last_date) return false;
  return job.last_date.slice(0, 10) >= closedJobIndexCutoff(today);
}

/**
 * The update category that is never indexed: the recruitment notice, which
 * duplicates a job page. See the note at the top of this file.
 */
export const UNINDEXED_UPDATE_CATEGORY = "notification" satisfies UpdateCategory;

/** Whether an update page asks to be indexed. */
export function isUpdateIndexable(update: { category: UpdateCategory }): boolean {
  return update.category !== UNINDEXED_UPDATE_CATEGORY;
}

/**
 * The robots metadata for a page that should not be indexed.
 *
 * `follow`, not `nofollow`. The page still links to the job it restates and to
 * its organisation's open vacancies, and those links are how a crawler reaches
 * the pages that should rank.
 */
export const NOINDEX_FOLLOW = { index: false, follow: true } as const;
