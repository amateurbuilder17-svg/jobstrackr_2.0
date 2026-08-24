import type { MetadataRoute } from "next";

import { env } from "@/lib/env";

/**
 * Crawler rules.
 *
 * Filtered and paginated list URLs are disallowed rather than merely
 * canonicalised. Every combination of ?q, ?tag, ?state and ?after is a distinct
 * URL rendering largely the same cards, so leaving them open spends the crawl
 * budget on near-duplicates instead of on the job pages that actually rank —
 * and each one that is crawled before it is cached costs a render.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/admin", "/jobs?", "/updates?"],
      },
    ],
    sitemap: `${env.NEXT_PUBLIC_SITE_URL}/sitemap.xml`,
    host: env.NEXT_PUBLIC_SITE_URL,
  };
}
