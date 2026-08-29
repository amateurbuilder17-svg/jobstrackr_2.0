import { NextResponse } from "next/server";

import { getIdentity, getUser } from "@/lib/auth/session";
import { listTrackedJobIds } from "@/lib/db/queries/attempts";
import { listSavedJobIds } from "@/lib/db/queries/saved";

/**
 * Everything the shell needs to know about the person using it.
 *
 * This endpoint is the reason /jobs and every job page can stay static. Per-user
 * state is fetched by the browser after the cached HTML has painted, rather than
 * making the page dynamic so it can render a filled-in bookmark icon or a name
 * in the corner. One small request per session buys back 2,700 statically
 * generated pages.
 *
 * ## Why identity travels with the saved ids
 *
 * It was `/api/saved` first, answering two questions — what is saved, what is
 * tracked — with a note explaining that splitting them would double the dynamic
 * requests a session makes to keep every static page static. The profile button
 * in the top bar asks a third question of the same session, at the same moment,
 * to light up a control sitting a few pixels from the other two. It belongs in
 * the same answer for exactly the reason the first two do.
 *
 * ## What is deliberately not here
 *
 * No profile fields beyond the display name, and no avatar URL. This response
 * is fetched on every page load; anything added to it is paid for on every page
 * load, by every signed-in user, forever. The profile page can afford its own
 * request because it is one page.
 */
export async function GET() {
  const user = await getUser();

  if (!user) {
    // A guest is a normal caller, not an error. Their shortlist lives in
    // localStorage until they sign in, and the client already knows that.
    return NextResponse.json(
      { signedIn: false, ids: [], trackedJobIds: [], identity: null },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // In parallel: independent reads of the same user's own rows. Running them in
  // sequence would make the session wait for every round trip rather than the
  // slowest one.
  const [ids, trackedJobIds, identity] = await Promise.all([
    listSavedJobIds(),
    listTrackedJobIds(),
    getIdentity(),
  ]);

  return NextResponse.json(
    { signedIn: true, ids, trackedJobIds, identity },
    {
      // Never cached, at any layer. This response is one user's private state,
      // and a shared cache holding it would hand it to the next visitor.
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
