import { connection } from "next/server";

import { listJobSlugs } from "@/lib/db/queries/jobs";
import { env } from "@/lib/env";
import {
  SITEMAP_CDN_SECONDS,
  renderUrlset,
  sitemapResponse,
  sitemapUnavailable,
} from "@/lib/seo/sitemap-xml";

/**
 * `/sitemaps/jobs.xml` — every job page that asks to be indexed.
 *
 * Open listings, and closed ones inside the index window (`listJobSlugs`,
 * `lib/seo/indexing.ts`). Read at request time and kept by the CDN for
 * `SITEMAP_CDN_SECONDS`; see `lib/seo/sitemap-xml.ts` for why this is not
 * prerendered.
 */
export async function GET(): Promise<Response> {
  // Nothing here is prerendered at build: the list is only as fresh as the
  // request that read it, and the CDN is what keeps the answer.
  await connection();

  let jobs: Awaited<ReturnType<typeof listJobSlugs>>;
  try {
    jobs = await listJobSlugs();
  } catch (error) {
    console.warn(
      "[sitemaps/jobs.xml] Database unreachable; answering 503.",
      error instanceof Error ? error.message : error,
    );
    return sitemapUnavailable();
  }

  const site = env.NEXT_PUBLIC_SITE_URL;

  // Weighted apart rather than listed alike: an open notice is worth
  // recrawling weekly because its dates still move, and a closed one is a
  // finished record that will never change again. A recently closed notice is
  // still looked up, but it should not compete with the jobs someone can still
  // apply to.
  return sitemapResponse(
    renderUrlset(
      jobs.map(({ slug, updated_at, closed }) => ({
        url: `${site}/jobs/${slug}`,
        lastModified: new Date(updated_at),
        changeFrequency: closed ? "yearly" : "weekly",
        priority: closed ? 0.3 : 0.8,
      })),
    ),
    SITEMAP_CDN_SECONDS.jobs,
  );
}
