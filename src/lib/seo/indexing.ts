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
 *
 * ── Every update, since 25 Sep 2026 ────────────────────────────────────────
 * The other categories went the same way three days later. Every update page
 * named a freejobalert.com article as its source, in `isBasedOn` and in the
 * link at its foot — all 5,374 updates in the 26 Aug 2026 backup came from
 * there — and the wording is that article's with synonyms swapped in
 * ("download" → "obtain", "collect"). Google indexes the original and declines
 * the copy, and scraped text with its words swapped is the pattern its policy
 * on scaled content names, which is a judgement that can weigh on the whole
 * site, job pages included. So the site asks to be judged on its job pages and
 * its hubs, and every update page, and every list made only of them, answers
 * `noindex, follow` and stays out of the sitemap and the push worker's
 * submissions. They all still answer 200 for the people reading them.
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
 * The update category that restates a job page: the recruitment notice. No
 * list shows it — not a hub, not the sitemap — because the job's own page is
 * the one to send a reader to. See the note at the top of this file.
 */
export const UNINDEXED_UPDATE_CATEGORY = "notification" satisfies UpdateCategory;

/**
 * Whether update pages ask to be indexed: none does, since 25 Sep 2026.
 *
 * One answer for all of them, so it takes no row. The page's robots meta, the
 * hubs' counts and the push worker all read it here, and it is the switch to
 * turn if updates are ever rebuilt from the official notices — the sitemap
 * would need its `updates.xml` back as well.
 */
export function isUpdateIndexable(): boolean {
  return false;
}

/**
 * The robots metadata for a page that should not be indexed.
 *
 * `follow`, not `nofollow`. The page still links to the job it restates and to
 * its organisation's open vacancies, and those links are how a crawler reaches
 * the pages that should rank.
 */
export const NOINDEX_FOLLOW = { index: false, follow: true } as const;
