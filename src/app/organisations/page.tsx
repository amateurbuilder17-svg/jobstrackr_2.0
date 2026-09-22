import type { Metadata } from "next";

import { HubIndex, type HubIndexGroup } from "@/components/hubs/hub-index";
import { getHubCensus } from "@/lib/db/queries/hubs";
import { MIN_INDEXED_HUB_ITEMS, organisationHub } from "@/lib/hubs/catalog";

export const metadata: Metadata = {
  title: "Government jobs by organisation",
  description:
    "Recruitment notifications, results and admit cards from every conducting body — SSC, UPSC, IBPS, RRB, state PSCs, PSUs and more.",
  alternates: { canonical: "/organisations" },
};

/**
 * Every organisation with at least `MIN_INDEXED_HUB_ITEMS` items, A to Z.
 *
 * Smaller employers are not listed. Their hubs resolve, and their notices are
 * reachable through the state, category and archive pages, but an index of
 * hundreds of one-line pages is a list of thin pages, which is the problem
 * this whole set of pages is meant to solve.
 */
export default async function OrganisationsIndexPage() {
  const { organisations } = await getHubCensus();

  const groups = new Map<string, HubIndexGroup>();
  for (const org of organisations) {
    const hub = organisationHub(org);
    const initial = org.name.trim().charAt(0).toUpperCase();
    const letter = /^[A-Z]$/.test(initial) ? initial : "#";
    const group = groups.get(letter) ?? { title: letter, links: [] };
    group.links.push({ href: hub.path, label: org.name, count: org.count });
    groups.set(letter, group);
  }

  return (
    <HubIndex
      heading="Government jobs by organisation"
      intro={`Every conducting body with at least ${String(MIN_INDEXED_HUB_ITEMS)} current notifications, results or admit cards, from A to Z.`}
      groups={[...groups.values()].sort((a, b) => (a.title ?? "").localeCompare(b.title ?? ""))}
    />
  );
}
