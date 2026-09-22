import type { Metadata } from "next";

import { NOINDEX_FOLLOW } from "@/lib/seo/indexing";

import { MIN_INDEXED_HUB_ITEMS, hubPagePath, type Hub } from "./catalog";

/**
 * The `<head>` for page `page` of a hub holding `total` items.
 *
 * Every page is its own canonical, page 2 included. Pointing page 2 at page 1
 * is the common mistake: it tells Google the two are the same document, so the
 * links that only page 2 carries are never followed as a crawl path — which
 * is the only reason these pages exist.
 */
export function hubMetadata(hub: Hub, page: number, total: number): Metadata {
  return {
    title: page > 1 ? `${hub.heading} — page ${String(page)}` : hub.heading,
    description: hub.description,
    alternates: { canonical: hubPagePath(hub, page) },
    ...(total >= MIN_INDEXED_HUB_ITEMS ? {} : { robots: NOINDEX_FOLLOW }),
  };
}
