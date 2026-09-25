import { env } from "@/lib/env";
import { CHILD_SITEMAPS, renderSitemapIndex } from "@/lib/seo/sitemap-xml";

/**
 * `/sitemap.xml` — the index of the three child sitemaps.
 *
 * The URL `robots.txt` names and Search Console already holds, so nothing has
 * to be resubmitted: an engine that reads an index follows it to the children.
 * It reads no data, so it is prerendered like `robots.txt` and changes only
 * when a deploy adds or removes a child. Why the children are route handlers
 * rather than a `sitemap.ts` is at the top of `lib/seo/sitemap-xml.ts`.
 */
export function GET(): Response {
  const site = env.NEXT_PUBLIC_SITE_URL;

  return new Response(renderSitemapIndex(CHILD_SITEMAPS.map((path) => `${site}${path}`)), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
