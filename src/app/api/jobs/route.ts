import { NextResponse, type NextRequest } from "next/server";

import { listJobs, toJobSort } from "@/lib/db/queries/jobs";
import { PAGE_SIZE } from "@/lib/db/cursor";
import { FILTER_GROUPS, optionOf, type JobLevel, type JobStream } from "@/lib/jobs/filters";

/**
 * Paginated jobs feed API for infinite scrolling.
 *
 * Narrowed against the known chip groups so invalid enums do not cause Postgres 500s.
 * Responses are cached at the Edge CDN with stale-while-revalidate to conserve
 * both Supabase database egress and Vercel serverless function invocations.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const query = searchParams.get("q") ?? undefined;
  const level = optionOf(FILTER_GROUPS[0], searchParams.get("level") ?? undefined) as
    JobLevel | undefined;
  const stream = optionOf(FILTER_GROUPS[1], searchParams.get("stream") ?? undefined) as
    JobStream | undefined;
  const sector = optionOf(FILTER_GROUPS[2], searchParams.get("sector") ?? undefined);
  const state = optionOf(FILTER_GROUPS[3], searchParams.get("state") ?? undefined);
  const sort = toJobSort(searchParams.get("sort") ?? undefined);
  const cursor = searchParams.get("after") ?? undefined;

  const page = await listJobs({
    query,
    state,
    level,
    stream,
    sector,
    sort,
    cursor,
    limit: PAGE_SIZE.list,
  });

  return NextResponse.json(
    {
      items: page.items,
      nextCursor: page.nextCursor,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600",
      },
    },
  );
}
