import type { Metadata } from "next";

import { HubIndex } from "@/components/hubs/hub-index";
import { censusCount, getHubCensus } from "@/lib/db/queries/hubs";
import { STATE_HUBS } from "@/lib/hubs/catalog";

export const metadata: Metadata = {
  title: "Government jobs by state",
  description:
    "Government job notifications for every Indian state and union territory, and the all-India recruitments open to everyone.",
  alternates: { canonical: "/states" },
};

/**
 * Every state hub with something in it. A state with nothing listed today is
 * left out rather than linked to an empty page; its hub still resolves for
 * anyone who has the URL.
 */
export default async function StatesIndexPage() {
  const census = await getHubCensus();
  const links = (hubs: typeof STATE_HUBS) =>
    hubs
      .map((hub) => ({
        href: hub.path,
        label: hub.label,
        count: censusCount(census, hub.filter),
      }))
      .filter((link) => link.count > 0);

  return (
    <HubIndex
      heading="Government jobs by state"
      intro="Every current government job notification, grouped by the state or union territory it is for. All-India recruitments are open to candidates from anywhere in the country."
      groups={[
        { links: links(STATE_HUBS.filter((h) => h.label === "All India")) },
        {
          title: "States and union territories",
          links: links(STATE_HUBS.filter((h) => h.label !== "All India")),
        },
      ]}
    />
  );
}
