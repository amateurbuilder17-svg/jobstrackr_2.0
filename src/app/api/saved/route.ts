import { NextResponse } from "next/server";

import { getUser } from "@/lib/auth/session";
import { listTrackedJobIds } from "@/lib/db/queries/attempts";
import { listSavedJobIds } from "@/lib/db/queries/saved";

/**
 * Which jobs the current user has saved, and which they track.
 *
 * This endpoint is the reason /jobs and every job page can stay static. Per-user
 * state is fetched by the browser after the cached HTML has painted, rather than
 * making the page dynamic so it can render a filled-in bookmark icon. One small
 * request per session buys back 240 statically generated pages.
 *
 * Ids only — the response is a few kB at the bound, against ~11 kB for a single
 * page of full cards.
 *
 * Both lists travel together deliberately. They are answered from the same
 * session, they light up two controls on the same row, and splitting them
 * would double the number of dynamic requests a session makes to keep every
 * static page static.
 */
export async function GET() {
  const user = await getUser();

  if (!user) {
    // A guest is a normal caller, not an error. Their shortlist lives in
    // localStorage until they sign in, and the client already knows that.
    return NextResponse.json(
      { signedIn: false, ids: [], trackedJobIds: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // In parallel: two independent reads of the same user's own rows, and
  // running them in sequence would make the session wait for both round trips
  // rather than the slower one.
  const [ids, trackedJobIds] = await Promise.all([listSavedJobIds(), listTrackedJobIds()]);

  return NextResponse.json(
    { signedIn: true, ids, trackedJobIds },
    {
      // Never cached, at any layer. This response is one user's private state,
      // and a shared cache holding it would hand it to the next visitor.
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
