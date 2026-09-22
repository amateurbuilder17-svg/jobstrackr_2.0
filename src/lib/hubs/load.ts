import "server-only";

import { notFound } from "next/navigation";

import { listHubPage, type HubPage } from "@/lib/db/queries/hubs";

import { hubPageCount, type Hub } from "./catalog";

/**
 * Page `page` of a hub, or a 404 past its last page.
 *
 * Called from the page function itself, above any Suspense boundary, so the
 * 404 is a real status and not a streamed "not found" under a 200 — the soft
 * 404 that 9532e4b fixed on /syllabus. Page 1 always renders, empty or not;
 * see `getHubOrganisation` for why a hub never 404s for being empty.
 */
export async function loadHubPage(hub: Hub, page: number): Promise<HubPage> {
  const result = await listHubPage(hub.key, hub.filter, page);
  if (page > hubPageCount(result.total)) notFound();
  return result;
}
