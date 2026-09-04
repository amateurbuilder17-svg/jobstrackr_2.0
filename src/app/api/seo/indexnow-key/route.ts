import { type NextRequest, NextResponse } from "next/server";

import { getServerEnv } from "@/lib/env.server";

/**
 * The IndexNow ownership proof.
 *
 * IndexNow has no accounts. Anyone may submit URLs for any host, so the
 * protocol verifies ownership by fetching `https://<host>/<key>.txt` and
 * checking that it contains the key that was submitted. Only someone who can
 * deploy to the host can make that file exist.
 *
 * This is a route rather than a file in `public/` because the key comes from
 * the environment. A committed key file is a key that cannot be rotated
 * without a commit, and — more to the point — one that a fork or a preview
 * deployment inherits, which is how a preview ends up announcing URLs on the
 * production domain's behalf.
 *
 * Reached through a rewrite in `next.config.ts` (`/:key.txt`), because the file
 * has to be at the site root: IndexNow requires the key location to be at or
 * above the directory of the URLs being submitted, and this site submits from
 * the root down.
 */

export function GET(request: NextRequest): NextResponse {
  const expected = getServerEnv().INDEXNOW_KEY;
  const requested = request.nextUrl.searchParams.get("key");

  // A 404 rather than a 403 for a wrong key: this endpoint's entire contract is
  // "this file exists if and only if the name matches", and answering
  // differently for a near-miss would turn it into a key oracle.
  if (!expected || requested !== expected) {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(expected, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // Long, because the answer changes only when the key is rotated, and the
      // verifier may fetch it on every submission.
      "cache-control": "public, max-age=86400, s-maxage=86400",
    },
  });
}
