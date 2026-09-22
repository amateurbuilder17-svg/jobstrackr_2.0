import type { Metadata } from "next";

import { hubRouteMetadata, renderHubRoute } from "@/components/hubs/hub-route";
import { BUILD_SENTINEL_SLUG } from "@/lib/db/build-params";

/**
 * Every indexable job in one state or union territory, or across All India.
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
  return hubRouteMetadata("state", slug);
}

export default async function StateHubPage({ params }: { params: Params }) {
  const { slug } = await params;
  return renderHubRoute("state", slug);
}
