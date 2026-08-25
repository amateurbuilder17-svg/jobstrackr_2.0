import type { MetadataRoute } from "next";

import { env } from "@/lib/env";
import { listJobSlugs } from "@/lib/db/queries/jobs";
import { listExamUpdateSlugs } from "@/lib/db/queries/exam-updates";

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
  const [jobs, updates] = await Promise.all([listJobSlugs(), listExamUpdateSlugs()]);

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: site, changeFrequency: "daily", priority: 1 },
    { url: `${site}/jobs`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${site}/updates`, changeFrequency: "hourly", priority: 0.8 },
    { url: `${site}/calendar`, changeFrequency: "weekly", priority: 0.5 },
  ];

  return [
    ...staticRoutes,
    ...jobs.map(({ slug, updated_at }) => ({
      url: `${site}/jobs/${slug}`,
      lastModified: new Date(updated_at),
      changeFrequency: "weekly" as const,
      priority: 0.8,
    })),
    ...updates.map(({ slug, updated_at }) => ({
      url: `${site}/updates/${slug}`,
      lastModified: new Date(updated_at),
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
