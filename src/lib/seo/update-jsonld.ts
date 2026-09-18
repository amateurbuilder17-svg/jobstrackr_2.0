import { decodeEntities } from "@/lib/format/text";
import { CATEGORY_LABELS } from "@/lib/updates/categories";
import type { ExamUpdateDetail } from "@/lib/db/queries/exam-updates";

/**
 * schema.org `Article` for an exam update.
 *
 * Not `NewsArticle`, and the distinction is worth stating because the wrong one
 * is the tempting one. `NewsArticle` is the type Google reads for Top Stories,
 * and Top Stories has publisher requirements this site does not meet and is not
 * trying to — an admit-card notice transcribed from an official portal is a
 * record, not reporting. `Article` is the honest type, and it is the one the
 * assistant crawlers read anyway when they are deciding what a page *is*.
 *
 * `headline` is capped at 110 characters because Google ignores the field
 * beyond that, and an update title carrying a full exam name with year and
 * post code goes past it more often than not.
 */
export function examUpdateJsonLd(
  update: ExamUpdateDetail,
  siteUrl: string,
): Record<string, unknown> {
  const url = `${siteUrl}/updates/${update.slug}`;
  const title = decodeEntities(update.title);

  const published = update.published_at ?? update.published_date;

  return {
    "@context": "https://schema.org",
    "@type": "Article",
    "@id": `${url}#article`,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    url,
    headline: title.slice(0, 110),
    // Only when there is a real summary. The alternative is restating the
    // headline as the description, which tells an engine nothing and reads as
    // padding to the people who see it under a result.
    ...(update.summary ? { description: decodeEntities(update.summary) } : {}),
    articleSection: CATEGORY_LABELS[update.category],
    inLanguage: "en-IN",

    // The share card, which is a real image at a stable URL. Article rich
    // results need one, and every page on this site has this one.
    image: `${siteUrl}/opengraph-image`,

    ...(published ? { datePublished: published } : {}),
    // `scraped_at` is when this row was last confirmed against its source,
    // which is the closest honest answer to "when did this page last change".
    // The alternative — omitting it — invites an engine to assume the
    // publication date is also the modification date, and a corrigendum
    // reissued last week would then look a month old.
    ...(update.scraped_at ? { dateModified: update.scraped_at } : {}),

    publisher: {
      "@type": "Organization",
      "@id": `${siteUrl}/#organization`,
      name: "JobsTrackr",
    },

    // The body that issued the notice, when it is known. `sameAs` rather than
    // `author`: this site transcribed the notice, the department issued it, and
    // naming the department as the author of this page would be a claim neither
    // party made.
    ...(update.organization
      ? {
          about: {
            "@type": "Organization",
            name: update.organization.name,
            ...(update.organization.website ? { sameAs: update.organization.website } : {}),
          },
        }
      : {}),

    // The page this was transcribed from. It is the single most useful field
    // here for an assistant deciding whether to trust the summary.
    ...(update.source_url ? { isBasedOn: update.source_url } : {}),
  };
}

/**
 * schema.org `ItemList` for the related rails at the foot of an update page.
 *
 * ── What this is worth, stated honestly ───────────────────────────────────
 * Not a rich result. Google renders `ItemList` as a carousel only for a short
 * list of verticals — recipes, courses, films, restaurants — and an exam
 * notice is none of them, so nothing about the page's appearance in search
 * changes because this is here. The `<a>` elements in the rails are what carry
 * the crawl path and the internal link equity, and they do that on their own.
 *
 * It earns its bytes somewhere else. `robots.ts` deliberately admits the
 * assistant crawlers — GPTBot, PerplexityBot, ClaudeBot and the rest — and an
 * enumerated list of titled URLs is markedly easier for one of those to read
 * as "here are the sibling documents" than a scroll container of styled
 * anchors. That is the claim being made, and it is a modest one.
 *
 * Capped at ten, and the cap is the point: this runs on ~5,300 statically
 * generated pages, so each entry is ~90 bytes multiplied by the whole corpus
 * on every crawl. An unbounded list here would be a Fast Origin Transfer bill,
 * which this project has already had once.
 */
export function updateRailsJsonLd(
  items: readonly { slug: string; title: string }[],
  siteUrl: string,
): Record<string, unknown> | null {
  if (items.length === 0) return null;

  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Related exam updates",
    itemListElement: items.slice(0, 10).map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: `${siteUrl}/updates/${item.slug}`,
      name: decodeEntities(item.title),
    })),
  };
}
