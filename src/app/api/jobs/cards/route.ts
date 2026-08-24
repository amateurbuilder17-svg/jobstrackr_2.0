import { NextResponse, type NextRequest } from "next/server";

import { listJobCardsByIds } from "@/lib/db/queries/jobs";
import { PAGE_SIZE } from "@/lib/db/cursor";

/**
 * Job cards for a set of ids.
 *
 * Exists for one caller: the saved list of a signed-out visitor, whose
 * shortlist is in their browser and unknown to the server. Everything it
 * returns is published, public content — the same rows /jobs serves — so this
 * discloses nothing that a crawler could not already read.
 *
 * The ids are the untrusted half. They are deduplicated and capped before the
 * query, so a hand-edited localStorage cannot turn this into a full-table read.
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("ids") ?? "";

  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, PAGE_SIZE.savedIds);

  if (ids.length === 0) {
    return NextResponse.json({ jobs: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  const jobs = await listJobCardsByIds(ids);

  return NextResponse.json(
    { jobs },
    {
      // The rows are public, but the *set* is this visitor's shortlist, so the
      // response is private to them even though its contents are not secret.
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
