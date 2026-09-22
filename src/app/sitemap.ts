import type { MetadataRoute } from "next";

import { env } from "@/lib/env";
import { listJobSlugs } from "@/lib/db/queries/jobs";
import { listExamUpdateSlugs } from "@/lib/db/queries/exam-updates";
import { listSyllabusSlugs } from "@/lib/db/queries/syllabus";

/**
 * Sitemap.
 *
 * Both queries are `"use cache"`d and tagged, so this is generated once and
 * regenerated only when content changes — not per crawler request. The old app
 * answered every /sitemap.xml hit with a serverless function and a fresh
 * Supabase read, which is a cost that scales with crawler enthusiasm rather
 * than with anything useful.
 *
 * Priorities are relative and only meaningful against each other: job pages are
 * the reason the site exists, updates support them, static pages are furniture.
 *
 * A sitemap here is the set of pages that ask to be indexed, which is smaller
 * than the set that answers 200. Closed listings stay for
 * `CLOSED_JOB_INDEX_DAYS` after their last date, and recruitment notices in the
 * updates feed are left out because they restate a job page. Both still
 * resolve, and both say `noindex` on the page itself, so the two signals agree.
 * `lib/seo/indexing.ts` has the rule and the measurements behind it.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const site = env.NEXT_PUBLIC_SITE_URL;

  // Degrades to the static routes if the database is unreachable: a sitemap
  // listing four URLs for one cache window is a small, self-healing problem,
  // whereas a failed build is an outage.
  //
  // The degrading happens *inside* each query, not here. This used to be a
  // `Promise.allSettled` with a rejected-branch fallback, which reads as
  // correct and cannot work: both queries are `"use cache"`, and a promise
  // rejecting inside a cache scope fails the build before any caller's handler
  // runs. Each query now returns an empty array on failure, so there is
  // nothing left to settle.
  const [jobs, updates, syllabi] = await Promise.all([
    listJobSlugs(),
    listExamUpdateSlugs(),
    listSyllabusSlugs(),
  ]);

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: site, changeFrequency: "daily", priority: 1 },
    { url: `${site}/jobs`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${site}/updates`, changeFrequency: "hourly", priority: 0.8 },
    // `/syllabus` is deliberately absent. The finder needs an account, so what a
    // crawler gets there is the sign-in card; submitting that URL would be
    // asking Google to rank a page nobody can read. The syllabi it links to are
    // public and listed below on their own.
    // Two public tools that earn their own searches and were simply never
    // listed. Both already declare a canonical; neither was reachable from
    // this file, so neither was ever submitted.
    { url: `${site}/quiz`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${site}/countdown`, changeFrequency: "daily", priority: 0.5 },
    { url: `${site}/faq`, changeFrequency: "monthly", priority: 0.4 },
    { url: `${site}/user-manual`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${site}/help`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${site}/privacy-policy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${site}/terms-of-service`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${site}/refund-policy`, changeFrequency: "yearly", priority: 0.2 },
  ];

  return [
    ...staticRoutes,
    // Open listings, and closed ones inside the index window — see
    // `listJobSlugs`. They are weighted apart rather than listed alike: an
    // open notice is worth recrawling weekly because its dates still move,
    // and a closed one is a finished record that will never change again.
    ...jobs.map(({ slug, updated_at, closed }) => ({
      url: `${site}/jobs/${slug}`,
      lastModified: new Date(updated_at),
      changeFrequency: closed ? ("yearly" as const) : ("weekly" as const),
      // Below the static pages and every open listing, above nothing: a
      // recently closed notice is still looked up, but it should not compete
      // with the jobs someone can still apply to.
      priority: closed ? 0.3 : 0.8,
    })),
    ...updates.map(({ slug, updated_at }) => ({
      url: `${site}/updates/${slug}`,
      lastModified: new Date(updated_at),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
    // Cached syllabi are real pages worth indexing: "SSC CGL syllabus" is a
    // search people make, and the answer here is a full one. `monthly` because
    // an entry is refetched at most that often — claiming `weekly` would ask
    // a crawler back for a page that provably has not changed.
    ...syllabi.map(({ slug, fetchedAt }) => ({
      url: `${site}/syllabus/${slug}`,
      lastModified: new Date(fetchedAt),
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
  ];
}
