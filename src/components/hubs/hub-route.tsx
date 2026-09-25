import "server-only";

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getHubOrganisation, listHubPage } from "@/lib/db/queries/hubs";
import {
  ALL_JOBS_HUB,
  ALL_UPDATES_HUB,
  categoryHub,
  organisationHub,
  parsePageNumber,
  stateHub,
  type Hub,
} from "@/lib/hubs/catalog";
import { loadHubPage } from "@/lib/hubs/load";
import { hubMetadata } from "@/lib/hubs/metadata";

import { HubView } from "./hub-view";

/**
 * What the hub routes share, so each route file is its params and nothing
 * else: `/states/[slug]`, `/categories/[slug]`, `/organisations/[slug]`, each
 * with a `/page/[n]` beneath it, and the two archives `/jobs/page/[n]` and
 * `/updates/page/[n]`.
 *
 * Every route pairs this with a `generateStaticParams` returning the build
 * sentinel. That is not for prerendering — no hub is built ahead of time,
 * each renders on its first request — but for the status code. Without a
 * param list, Cache Components answers an unknown slug from the route's App
 * Shell with a 200 before `notFound()` can run; 9532e4b is that bug on
 * /syllabus. With one, an unlisted slug renders in full before the response
 * starts, and a 404 is a 404.
 */
export type HubRouteKind = "state" | "category" | "organisation" | "allJobs" | "allUpdates";

async function hubFor(kind: HubRouteKind, slug: string): Promise<Hub | undefined> {
  switch (kind) {
    case "state":
      return stateHub(slug);
    case "category":
      return categoryHub(slug);
    case "organisation": {
      const org = await getHubOrganisation(slug);
      return org ? organisationHub(org) : undefined;
    }
    case "allJobs":
      return ALL_JOBS_HUB;
    case "allUpdates":
      return ALL_UPDATES_HUB;
  }
}

/**
 * The page a route is showing: 1 on a hub's bare path, or its `[n]` segment —
 * from 2 on a hub, whose page 1 is the bare path, and from 1 on an archive.
 */
function pageFrom(kind: HubRouteKind, n: string | undefined): number | null {
  if (n === undefined) return 1;
  return parsePageNumber(n, kind === "allJobs" || kind === "allUpdates" ? 1 : 2);
}

export async function hubRouteMetadata(
  kind: HubRouteKind,
  slug: string,
  n?: string,
): Promise<Metadata> {
  const hub = await hubFor(kind, slug);
  const page = pageFrom(kind, n);
  if (!hub || page === null) return { title: "Page not found" };

  // The same cached read the page makes, so this costs nothing extra.
  const { indexable } = await listHubPage(hub.key, hub.filter, page);
  return hubMetadata(hub, page, indexable);
}

/** The page itself, or a 404 for an unknown hub or a page past the end. */
export async function renderHubRoute(kind: HubRouteKind, slug: string, n?: string) {
  const hub = await hubFor(kind, slug);
  const page = pageFrom(kind, n);
  if (!hub || page === null) notFound();

  const result = await loadHubPage(hub, page);
  return <HubView hub={hub} page={page} result={result} />;
}
