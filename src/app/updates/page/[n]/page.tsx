import type { Metadata } from "next";

import { hubRouteMetadata, renderHubRoute } from "@/components/hubs/hub-route";
import { BUILD_SENTINEL_SLUG } from "@/lib/db/build-params";

/**
 * Every indexable update, newest first, fifty to a page. The updates
 * counterpart of `/jobs/page/[n]`.
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
  return hubRouteMetadata("allUpdates", "", n);
}

export default async function AllUpdatesPage({ params }: { params: Params }) {
  const { n } = await params;
  return renderHubRoute("allUpdates", "", n);
}
