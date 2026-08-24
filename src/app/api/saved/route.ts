import { NextResponse } from "next/server";

import { getUser } from "@/lib/auth/session";
import { listSavedJobIds } from "@/lib/db/queries/saved";

/**
 * Which jobs the current user has saved.
 *
 * This endpoint is the reason /jobs and every job page can stay static. Per-user
 * state is fetched by the browser after the cached HTML has painted, rather than
 * making the page dynamic so it can render a filled-in bookmark icon. One small
 * request per session buys back 240 statically generated pages.
 *
 * Ids only — the response is a few kB at the bound, against ~11 kB for a single
 * page of full cards.
 */
export async function GET() {
  const user = await getUser();

  if (!user) {
    // A guest is a normal caller, not an error. Their shortlist lives in
    // localStorage until they sign in, and the client already knows that.
    return NextResponse.json(
      { signedIn: false, ids: [] },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const ids = await listSavedJobIds();

  return NextResponse.json(
    { signedIn: true, ids },
    {
      // Never cached, at any layer. This response is one user's private state,
      // and a shared cache holding it would hand it to the next visitor.
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
