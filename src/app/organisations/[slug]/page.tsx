import type { Metadata } from "next";

import { hubRouteMetadata, renderHubRoute } from "@/components/hubs/hub-route";
import { BUILD_SENTINEL_SLUG } from "@/lib/db/build-params";

/**
 * One conducting body's indexable jobs and updates, in one list, newest first.
 *
 * The sentinel is there for the 404s, not to prerender anything; see
 * `components/hubs/hub-route.tsx`.
 */
type Params = Promise<{ slug: string }>;

export function generateStaticParams() {
  return [{ slug: BUILD_SENTINEL_SLUG }];
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { slug } = await params;
  return hubRouteMetadata("organisation", slug);
}

export default async function OrganisationHubPage({ params }: { params: Params }) {
  const { slug } = await params;
  return renderHubRoute("organisation", slug);
}
