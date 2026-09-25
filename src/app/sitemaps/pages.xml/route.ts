import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { censusIndexable, getHubCensus } from "@/lib/db/queries/hubs";
import { listSyllabusSlugs } from "@/lib/db/queries/syllabus";
import { env } from "@/lib/env";
import {
  ALL_JOBS_HUB,
  CATEGORY_HUBS,
  MIN_INDEXED_HUB_ITEMS,
  STATE_HUBS,
  hubPagePath,
  organisationHub,
} from "@/lib/hubs/catalog";
import { SITEMAP_CDN_SECONDS, renderUrlset, sitemapResponse } from "@/lib/seo/sitemap-xml";

/**
 * `/sitemaps/pages.xml` — everything that is not a job or an update page.
 *
 * The site's own pages, the hubs, and the cached syllabi. Priorities are
 * relative and only meaningful against the job file: job pages are the reason
 * the site exists and static pages are furniture — except the hubs, which are
 * the crawl path into everything below them.
 *
 * Nothing made only of updates is here: not `/updates`, not its archive, not a
 * category of updates. Since 25 Sep 2026 those answer `noindex`, like the
 * update pages they list (`lib/seo/indexing.ts`), and an employer's hub is
 * listed on its jobs alone — the counts are `censusIndexable`, the same rule
 * each hub applies to its own robots meta.
 *
 * Both reads here are `"use cache"`d for the hub and syllabus pages that share
 * them, and both degrade to empty rather than throwing, as they always have: a
 * window in which this file lists only the static pages is a small problem that
 * heals when the CDN's copy expires. Read at request time and kept by the CDN
 * for `SITEMAP_CDN_SECONDS`; see `lib/seo/sitemap-xml.ts`.
 */
export async function GET(): Promise<Response> {
  await connection();

  const site = env.NEXT_PUBLIC_SITE_URL;
  const [census, syllabi] = await Promise.all([getHubCensus(), listSyllabusSlugs()]);

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: site, changeFrequency: "daily", priority: 1 },
    { url: `${site}/jobs`, changeFrequency: "hourly", priority: 0.9 },
    // The hub indexes and the first page of the job archive: the footer links
    // to all of them from every page on the site.
    { url: `${site}/organisations`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${site}/states`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${site}/categories`, changeFrequency: "weekly", priority: 0.7 },
    { url: `${site}${hubPagePath(ALL_JOBS_HUB, 1)}`, changeFrequency: "daily", priority: 0.6 },
    // `/syllabus` is deliberately absent. The finder needs an account, so what a
    // crawler gets there is the sign-in card; submitting that URL would be
    // asking Google to rank a page nobody can read. The syllabi it links to are
    // public and listed below on their own.
    // Two public tools that earn their own searches and were simply never
    // listed. Both already declare a canonical.
    { url: `${site}/quiz`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${site}/countdown`, changeFrequency: "daily", priority: 0.5 },
    { url: `${site}/faq`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${site}/user-manual`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${site}/help`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${site}/privacy-policy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${site}/terms-of-service`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${site}/refund-policy`, changeFrequency: "yearly", priority: 0.2 },
  ];

  // Hubs sit above the detail pages in priority. Only page 1 of each: the
  // later pages are found by following the pager, which is what they exist to
  // be walked by. Hubs under `MIN_INDEXED_HUB_ITEMS` answer `noindex` and are
  // left out, so no URL here contradicts its own robots meta. No `lastmod`:
  // the census knows how many items a hub holds, not when its list last
  // changed, and a made-up date is worse than none.
  const hubRoutes: MetadataRoute.Sitemap = [
    ...[...STATE_HUBS, ...CATEGORY_HUBS]
      .filter((hub) => censusIndexable(census, hub.filter) >= MIN_INDEXED_HUB_ITEMS)
      .map((hub) => ({
        url: `${site}${hub.path}`,
        changeFrequency: "daily" as const,
        priority: 0.7,
      })),
    // The census lists employers with enough items of any kind; the hub asks
    // to be indexed only on enough jobs.
    ...census.organisations
      .filter((org) => org.indexable >= MIN_INDEXED_HUB_ITEMS)
      .map((org) => ({
        url: `${site}${organisationHub(org).path}`,
        changeFrequency: "daily" as const,
        priority: 0.7,
      })),
  ];

  // Cached syllabi are real pages worth indexing: "SSC CGL syllabus" is a
  // search people make, and the answer here is a full one. `monthly` because
  // an entry is refetched at most that often.
  const syllabusRoutes: MetadataRoute.Sitemap = syllabi.map(({ slug, fetchedAt }) => ({
    url: `${site}/syllabus/${slug}`,
    lastModified: new Date(fetchedAt),
    changeFrequency: "monthly",
    priority: 0.5,
  }));

  return sitemapResponse(
    renderUrlset([...staticRoutes, ...hubRoutes, ...syllabusRoutes]),
    SITEMAP_CDN_SECONDS.pages,
  );
}
