import type { Metadata } from "next";

import { hubRouteMetadata, renderHubRoute } from "@/components/hubs/hub-route";
import { BUILD_SENTINEL_SLUG } from "@/lib/db/build-params";

/**
 * Every indexable job, newest first, fifty to a page.
 *
 * The one list guaranteed to reach every job page whatever its state, sector
 * or employer — /jobs itself loads more through client JavaScript, and its
 * query-string forms are disallowed in `robots.txt`. `/jobs/page` alone is
 * the job slug "page", which does not exist, so it 404s like any other.
 *
 * The sentinel is there for the 404s, not to prerender anything; see
 * `components/hubs/hub-route.tsx`. It is not a page number, so it renders the
 * 404 without a query.
 */
type Params = Promise<{ n: string }>;

export function generateStaticParams() {
  return [{ n: BUILD_SENTINEL_SLUG }];
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { n } = await params;
  return hubRouteMetadata("allJobs", "", n);
}

export default async function AllJobsPage({ params }: { params: Params }) {
  const { n } = await params;
  return renderHubRoute("allJobs", "", n);
}
