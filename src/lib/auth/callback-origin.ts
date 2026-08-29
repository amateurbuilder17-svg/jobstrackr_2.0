import "server-only";

import { headers } from "next/headers";

import { env } from "@/lib/env";

/**
 * The origin an out-of-band sign-in should come back to.
 *
 * Every auth round trip — Google, the signup confirmation email, the recovery
 * link — hands the auth server an absolute URL to return the browser to. That
 * URL used to be built from `NEXT_PUBLIC_SITE_URL` unconditionally, which is
 * correct in production and wrong the moment the dev server is not on the port
 * that variable names.
 *
 * The failure is silent and total: the app answers on :3200, the round trip is
 * told to return to :3100, and after Google authenticates the user the browser
 * lands on a port with nothing listening. The auth server's own log shows the
 * sign-in succeeding — the code exchange that should follow it never arrives,
 * because the request carrying the code was never delivered to anything.
 *
 * So on a loopback host the origin comes from the request instead: whatever
 * port `next dev` actually ended up on is the port the round trip returns to.
 *
 * Everywhere else the configured value still wins, and that asymmetry is the
 * point rather than an omission. `Host` is caller-controlled, so trusting it in
 * production would let a forged header aim a real sign-in link at another
 * origin. Loopback is the one case where that buys an attacker nothing: a
 * request can only arrive with a loopback host from the same machine, and the
 * link it produces is only good on that machine.
 */
export async function callbackOrigin(): Promise<string> {
  const requestHeaders = await headers();
  return originForHost(requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"));
}

/**
 * Split out from the header read so it can be tested without a request. Takes
 * the `Host` header as it arrives — `localhost:3100`, `[::1]:3100`, or a bare
 * hostname — and returns the origin to send the auth server.
 */
export function originForHost(host: string | null): string {
  if (!host) return env.NEXT_PUBLIC_SITE_URL;

  // `Host` is host[:port], and an IPv6 literal is bracketed so its own colons
  // cannot be mistaken for the port separator.
  const hostname = host
    .replace(/:\d+$/, "")
    .replace(/^\[(.*)\]$/, "$1")
    .toLowerCase();

  const isLoopback = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  if (!isLoopback) return env.NEXT_PUBLIC_SITE_URL;

  // http, not https: a loopback dev server serves plain http, and the scheme
  // has to match or the browser is sent somewhere it cannot connect either.
  return `http://${host}`;
}
