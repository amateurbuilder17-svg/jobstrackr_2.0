import { NextResponse } from "next/server";

/**
 * A redirect the CDN is allowed to keep.
 *
 * The legacy `/job/:id` and `/exam-update/:id` handlers need a database lookup,
 * so they cannot be `redirects()` entries. `permanentRedirect()` from a route
 * handler sends no cache header, though, which made every crawler visit to one
 * of the ~5,200 indexed legacy URLs a fresh function invocation and a Supabase
 * round trip — Hobby-plan invocations, CPU and origin transfer spent re-deriving
 * an answer that never changes.
 *
 * A resolved id maps to one slug forever, so its 308 is cached for a year. A
 * miss is answered by `cachedGone` below instead.
 */
export function cachedRedirect(request: Request, path: string): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.url), 308);
  response.headers.set("Cache-Control", "public, max-age=86400, s-maxage=31536000");
  return response;
}

const ONWARD = {
  job: { what: "This job listing", path: "/jobs", label: "See the jobs open now" },
  update: { what: "This update", path: "/updates", label: "See the latest exam updates" },
} as const;

/**
 * A legacy id that resolves to nothing, answered 410 Gone.
 *
 * A miss used to redirect to the list page. Google reads many URLs redirecting
 * to one generic page as a not-found in disguise, and files them under "Soft
 * 404" — one of the two shapes behind the 457 soft 404s in the 22 Sep 2026
 * Search Console report. 410 says the same thing plainly, so the URL leaves
 * the crawl queue instead of being retried as a suspicious redirect.
 *
 * The body is for the person holding an old WhatsApp forward, not for the
 * crawler: one line saying what happened and a link to the list they used to
 * be sent to. Plain HTML, because a route handler cannot render the app's
 * not-found page, and a dead link is not worth a full page render.
 *
 * Cached for a day, as the miss redirect was: the row may simply not be
 * ingested yet, and a day is how long that answer is allowed to be wrong.
 */
export function cachedGone(kind: keyof typeof ONWARD): NextResponse {
  const { what, path, label } = ONWARD[kind];
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>No longer available · JobsTrackr</title>
</head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5">
<h1 style="font-size:1.25rem">No longer available</h1>
<p>${what} is no longer on JobsTrackr.</p>
<p><a href="${path}">${label}</a></p>
</body>
</html>
`;

  return new NextResponse(html, {
    status: 410,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=86400",
    },
  });
}
