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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("ids") ?? "";

  // Shape, not just count. An earlier version capped how many ids could
  // arrive but not what they looked like, so `?ids=x` reached Postgres as an
  // invalid uuid literal and the whole request 500'd. These come from
  // localStorage, which anyone can edit — a malformed entry from an old
  // format, or a hand-typed one, should return nothing rather than an error.
  const ids = raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => UUID.test(id))
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
