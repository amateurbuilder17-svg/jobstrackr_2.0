import { NextResponse, type NextRequest } from "next/server";

import { safeNext } from "@/lib/auth/form-state";
import { sessionDb } from "@/lib/db/clients";
import { consume, LIMITS } from "@/lib/rate-limit";

/**
 * Where the Google Identity Services button lands, as opposed to
 * `/auth/callback`, where the redirect flow lands.
 *
 * The difference is which party Google was asked by. In the redirect flow the
 * request is made by Supabase's auth server, so Google names the app after the
 * host of that server's callback — `<ref>.supabase.co`, which is what the
 * consent screen said. Here the request is made by this origin's own client ID
 * in the browser, so Google names the app after the OAuth consent screen's app
 * name. Same Google project, same client ID, same Supabase user: the only thing
 * that changes is who asked, and therefore what the account chooser says.
 *
 * What arrives is a Google ID token — a signed JWT, already verified by nobody
 * yet. `signInWithIdToken` hands it to Supabase, which checks the signature
 * against Google's keys, the audience against the provider's configured client
 * ID, and the `nonce` claim against the SHA-256 of the raw nonce sent here. It
 * then issues this app's own session, exactly as the redirect flow does, into
 * exactly the same cookies — so everything downstream is unchanged.
 */
export async function POST(request: NextRequest) {
  // Login CSRF, not ordinary CSRF: an attacker who can post here signs the
  // victim into the *attacker's* account, and then owns everything the victim
  // saves afterwards. Two cheap checks close it. A cross-origin page cannot
  // send `application/json` without a preflight, and this route answers none;
  // and `Origin` on a same-origin POST is this origin, which a page on another
  // one cannot forge.
  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim();
  if (contentType !== "application/json") {
    return NextResponse.json({ error: "Unsupported media type." }, { status: 415 });
  }

  const origin = request.headers.get("origin");
  if (origin !== null && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Cross-origin request refused." }, { status: 403 });
  }

  // Keyed by IP rather than by account: there is no address to key on until the
  // token has been verified, and verification is the work being protected.
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!consume(`google-id:${ip}`, LIMITS.signIn)) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Wait a minute and try again." },
      { status: 429 },
    );
  }

  let body: { credential?: unknown; nonce?: unknown; next?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const credential = typeof body.credential === "string" ? body.credential : "";
  const nonce = typeof body.nonce === "string" ? body.nonce : undefined;
  if (!credential) {
    return NextResponse.json({ error: "No Google credential supplied." }, { status: 400 });
  }

  const db = await sessionDb();
  const { error } = await db.auth.signInWithIdToken({
    provider: "google",
    token: credential,
    ...(nonce ? { nonce } : {}),
  });

  if (error) {
    // Deliberately not Supabase's message. It distinguishes an expired token
    // from a rejected audience from a nonce mismatch, and none of those tell a
    // user anything they can act on — while all of them tell a prober how this
    // project is configured.
    return NextResponse.json(
      { error: "Google sign-in failed. Please try again." },
      { status: 401 },
    );
  }

  // The session is in the response's cookies now. The client navigates rather
  // than being redirected, because a `fetch` follows a 303 itself and the
  // browser would never leave the sign-in page.
  return NextResponse.json({
    redirect: safeNext(typeof body.next === "string" ? body.next : null),
  });
}
