import type { Metadata } from "next";

import { HubIndex } from "@/components/hubs/hub-index";
import { censusCount, getHubCensus } from "@/lib/db/queries/hubs";
import { CATEGORY_GROUP_LABELS, CATEGORY_HUBS, type CategoryGroup } from "@/lib/hubs/catalog";

export const metadata: Metadata = {
  title: "Government jobs and exam updates by category",
  description:
    "Government jobs by sector and by qualification — 10th pass, 12th pass, graduate — and exam results, admit cards and answer keys.",
  alternates: { canonical: "/categories" },
};

/** Every category hub with something in it, in the catalogue's three groups. */
export default async function CategoriesIndexPage() {
  const census = await getHubCensus();
  const group = (g: CategoryGroup) => ({
    title: CATEGORY_GROUP_LABELS[g],
    links: CATEGORY_HUBS.filter((hub) => hub.group === g)
      .map((hub) => ({
        href: hub.path,
        label: hub.label,
        count: censusCount(census, hub.filter),
      }))
      .filter((link) => link.count > 0),
  });

  return (
    <HubIndex
      heading="Browse by category"
      intro="Government jobs grouped by sector and by the minimum qualification they ask for, and exam updates grouped by what they are: results, admit cards, answer keys and more."
      groups={[group("update"), group("sector"), group("level")]}
    />
  );
}
