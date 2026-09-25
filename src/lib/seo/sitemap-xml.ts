import type { MetadataRoute } from "next";

/**
 * The sitemap as route handlers, and why it is not a `sitemap.ts`.
 *
 * ── What was wrong ─────────────────────────────────────────────────────────
 * Measured on 25 Sep 2026: the live sitemap was byte-for-byte the one the
 * 22 Sep build had written. Its newest `lastmod` was 10:52:40 UTC on the 22nd,
 * the minute that deployment was built, and none of the fourteen updates
 * published on the 24th and 25th, nor the job published on the 23rd, were in
 * it — though all fifteen were live on /updates and /jobs. `sitemap.ts` was the
 * only route handler in the build set to refresh on a timer, and on Vercel it
 * never did: ingest expired its tags on every run that wrote, its six-hour
 * window lapsed eleven times, and the file stayed exactly as the build left it.
 * It was served like `robots.txt`, which is plainly static, and without the
 * `x-nextjs-prerender` header that every page refreshing on its timer carried —
 * /organisations, /states and /categories had all been rebuilt since the same
 * deploy. Every page published between two deploys was missing from the file
 * that tells Google it exists.
 *
 * ── What replaces it ───────────────────────────────────────────────────────
 * Route handlers that read the database at request time and let the CDN keep
 * the answer for `SITEMAP_CDN_SECONDS`. The CDN honours `s-maxage` from a
 * route handler — the legacy `/job/:id` misses already rely on it — so how
 * fresh the file is no longer depends on the framework's cache handling. A new
 * job reaches the sitemap within six hours of being published, whether or not
 * anything is deployed.
 *
 * It is also split, which is worth having for its own sake. `/sitemap.xml` is
 * an index of one file per kind of page, and Search Console reports indexing
 * for each sitemap it is given. "Of the job pages, how many did Google index?"
 * becomes a number it shows rather than a guess. There is no `updates.xml`:
 * since 25 Sep 2026 no update page asks to be indexed (`lib/seo/indexing.ts`),
 * and a sitemap listing pages that answer `noindex` is the contradiction
 * Search Console reports as an error.
 */

/** The child sitemaps `/sitemap.xml` lists, as paths under the site root. */
export const CHILD_SITEMAPS = ["/sitemaps/pages.xml", "/sitemaps/jobs.xml"] as const;

/**
 * How long the CDN may serve one copy of each child sitemap.
 *
 * The window is the cost control as well as the staleness bound. However often
 * crawlers ask, a CDN region rebuilds a child at most once per window, and a
 * rebuild is a paged read of the corpus (`sitemapRegenerationKb` in
 * `scripts/check-traffic-budget.mjs`) plus ~0.9 MB of XML sent from the
 * function to the CDN, which Vercel meters as Fast Origin Transfer.
 *
 *   jobs   Six hours, the window the old `sitemap.ts` was meant to have.
 *          Google hears about a new job page from nowhere else: on 25 Sep
 *          2026 the Indexing API worker had no credentials in production
 *          (docs/SEO.md), and IndexNow reaches Bing, not Google.
 *   pages  A day. Hubs and the site's own pages change slowly.
 */
export const SITEMAP_CDN_SECONDS = {
  jobs: 6 * 60 * 60,
  pages: 24 * 60 * 60,
} as const;

/**
 * How long a stale copy may still be served while the CDN fetches a new one.
 * A crawler is never kept waiting on a rebuild, and a day of grace covers a
 * database that is briefly unreachable when the window ends.
 */
const STALE_WHILE_REVALIDATE_SECONDS = 24 * 60 * 60;

/** The five characters XML reserves. Slugs never contain them; the escape is for correctness. */
function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * A `<urlset>`, in the same shape Next's `sitemap.ts` convention wrote, so the
 * entries built for it carry over unchanged. Only the fields this site uses
 * are supported: no alternates, images or videos.
 */
export function renderUrlset(entries: MetadataRoute.Sitemap): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  for (const entry of entries) {
    xml += "<url>\n";
    xml += `<loc>${escapeXml(entry.url)}</loc>\n`;
    if (entry.lastModified) {
      const date =
        entry.lastModified instanceof Date
          ? entry.lastModified.toISOString()
          : entry.lastModified;
      xml += `<lastmod>${escapeXml(date)}</lastmod>\n`;
    }
    if (entry.changeFrequency) xml += `<changefreq>${entry.changeFrequency}</changefreq>\n`;
    if (typeof entry.priority === "number")
      xml += `<priority>${String(entry.priority)}</priority>\n`;
    xml += "</url>\n";
  }

  return `${xml}</urlset>\n`;
}

/**
 * A `<sitemapindex>` over absolute sitemap URLs.
 *
 * No `<lastmod>` per child. The index is built once per deploy and cannot know
 * when a child last changed, and a date that is not true is worse than none.
 */
export function renderSitemapIndex(urls: readonly string[]): string {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  for (const url of urls) xml += `<sitemap>\n<loc>${escapeXml(url)}</loc>\n</sitemap>\n`;
  return `${xml}</sitemapindex>\n`;
}

/**
 * A sitemap response the CDN keeps for `cdnSeconds`.
 *
 * `max-age=0` so a browser or a crawler's own cache always asks again; the
 * shared copy is the CDN's, and `s-maxage` is the only lifetime that matters.
 * Vercel strips `s-maxage` from what it forwards, so the header a client sees
 * reads `public, max-age=0`.
 */
export function sitemapResponse(xml: string, cdnSeconds: number): Response {
  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": `public, max-age=0, s-maxage=${String(cdnSeconds)}, stale-while-revalidate=${String(STALE_WHILE_REVALIDATE_SECONDS)}`,
    },
  });
}

/**
 * The answer when the database cannot be read.
 *
 * A child that degraded to an empty `<urlset>` would be cached for six hours
 * and tell every engine that asked in that window the site has no job pages.
 * A 503 is not cached, and it says "try later" in the one way crawlers agree
 * on. A sitemap that fails to fetch takes away nothing an engine already
 * knows; it is simply read again later.
 */
export function sitemapUnavailable(): Response {
  return new Response("Sitemap temporarily unavailable.\n", {
    status: 503,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": "3600",
    },
  });
}
