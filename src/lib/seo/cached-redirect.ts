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
 * miss is cached for a day only: the row may simply not be ingested yet.
 */
export function cachedRedirect(
  request: Request,
  path: string,
  permanent: boolean,
): NextResponse {
  const response = NextResponse.redirect(new URL(path, request.url), permanent ? 308 : 307);
  response.headers.set(
    "Cache-Control",
    permanent
      ? "public, max-age=86400, s-maxage=31536000"
      : "public, max-age=0, s-maxage=86400",
  );
  return response;
}
