import { NextResponse, type NextRequest } from "next/server";

import { listExamUpdates, toUpdateSort } from "@/lib/db/queries/exam-updates";
import { PAGE_SIZE } from "@/lib/db/cursor";
import { CATEGORY_FILTERS, type UpdateCategory } from "@/lib/updates/categories";

function isCategory(value: string | undefined): value is UpdateCategory {
  return value !== undefined && CATEGORY_FILTERS.some((filter) => filter.value === value);
}

/**
 * Paginated exam updates feed API for infinite scrolling.
 *
 * Narrowed against the known categories to avoid invalid enum literals reaching Postgres.
 * Edge CDN cached to prevent unnecessary Supabase queries and Vercel compute.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const categoryParam = searchParams.get("category") ?? undefined;
  const examSlug = searchParams.get("exam") ?? undefined;
  const query = searchParams.get("q") ?? undefined;
  const sort = toUpdateSort(searchParams.get("sort") ?? undefined);
  const cursor = searchParams.get("after") ?? undefined;

  const page = await listExamUpdates({
    category: isCategory(categoryParam) ? categoryParam : undefined,
    examSlug,
    query,
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
