import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";

/**
 * Session refresh and route protection.
 *
 * Named `proxy`, in `src/proxy.ts`. Next 16 renamed this convention from
 * `middleware`, which now logs a deprecation on every build and is scheduled
 * for removal. The behaviour, the matcher and the reasoning below are all
 * unchanged — only the file and the exported function name moved.
 *
 * Two jobs, both of which have to happen before a page renders:
 *
 * 1. **Refresh the access token.** Supabase tokens are short-lived. Only a
 *    middleware response can actually persist the rotated cookies — a Server
 *    Component may read cookies but not set them — so without this, a session
 *    silently expires and the user is signed out by a page refresh.
 *
 * 2. **Redirect before render.** Protection decided on the server means an
 *    unauthenticated visitor to /profile never receives the page at all. The
 *    alternative — render, discover there is no user, redirect on the client —
 *    is the "auth flash": a frame of signed-in layout for someone who is not.
 *
 * ## Why the matcher is narrow
 *
 * The usual recipe matches every route except static files. That would run this
 * function on `/jobs/[slug]` too — 240 statically generated pages whose whole
 * purpose is to be served from the CDN without invoking anything. Crawler
 * traffic alone would turn that into a per-hit function invocation, which is
 * cause #6 of the rebuild, reintroduced by the auth layer.
 *
 * So the matcher lists only routes that genuinely need a session. Public
 * content stays untouched and fully cacheable. This is sound because the shell
 * renders no user-specific state: a page that showed the signed-in user's name
 * would be dynamic anyway, and would need its own reason to opt in.
 */

/** Routes that require a signed-in user. Prefix match, so children are covered. */
/**
 * `/saved` is deliberately absent: a signed-out visitor has a real shortlist in
 * their browser, and redirecting them to sign in to see their own saved jobs
 * would be the app hiding their data from them. The page renders from
 * localStorage for guests and from the database for everyone else.
 */
const PROTECTED = [
  "/profile",
  "/tracker",
  "/for-you",
  "/admin",
  // Both hold identity data and neither has anything to show a guest.
  "/my-details",
  "/documents",
] as const;

/**
 * Routes a signed-in user has no reason to see. `/reset-password` is
 * deliberately absent: exchanging a recovery link signs the user in, so
 * bouncing authenticated users away from it would break the one flow that
 * depends on arriving there already authenticated.
 */
const AUTH_ONLY = ["/sign-in", "/sign-up", "/forgot-password"] as const;

export async function proxy(request: NextRequest) {
  // Mutable because the Supabase client may rotate cookies mid-call, and the
  // response carrying them has to be rebuilt around the updated request.
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          // Both halves matter. The request copy is what this same middleware
          // pass reads back; the response copy is what reaches the browser.
          // Setting only one produces a session that works for exactly one
          // request and then vanishes.
          for (const { name, value } of toSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser, not getSession. getSession returns whatever the cookie claims
  // without verifying it, so a forged cookie would pass; getUser validates
  // against the auth server and is what performs the refresh.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = "";
    // Preserved so signing in returns the user to what they asked for. Read
    // back through `safeNext` in the sign-in action, which rejects absolute
    // URLs — an unchecked `next` is an open redirect.
    url.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  if (user && AUTH_ONLY.some((p) => pathname === p)) {
    const url = request.nextUrl.clone();
    url.pathname = "/profile";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Literal prefixes only — Next parses this statically, so the arrays above
  // cannot be interpolated here. Keep the two in step when adding a route.
  matcher: [
    "/profile/:path*",
    "/my-details/:path*",
    "/documents/:path*",
    "/tracker/:path*",
    "/for-you/:path*",
    "/admin/:path*",
    "/sign-in",
    "/sign-up",
    "/forgot-password",
    "/reset-password",
  ],
};
