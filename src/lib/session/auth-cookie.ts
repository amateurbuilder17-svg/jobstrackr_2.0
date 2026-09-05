/**
 * What the browser can work out about its own session without asking the server.
 *
 * `@supabase/ssr` writes the session cookie without `httpOnly`, deliberately, so
 * the client can read it. Two questions are answered from it here:
 *
 *   1. **Has the session changed?** — `authCookieNames`, a string that differs
 *      whenever the set of session cookies does. `SessionProvider` compares it
 *      against the value it last asked `/api/session` about, which is how a
 *      sign-in or sign-out is noticed without a request per navigation.
 *
 *   2. **Whose session is it?** — `readAuthCookieUser`, which digs the user id
 *      out of the cookie's payload. That id is what keys the session cache in
 *      `./cache`, and it is the whole reason a cached copy of one person's
 *      shortlist cannot be painted for the next person on the same browser.
 *
 * Neither is an authority. `/api/session` decides who is signed in and what
 * they have saved; a cookie proves only that the browser is holding something
 * that looks like a session. Everything here exists to paint sooner, so every
 * failure below — a cookie that is absent, chunked oddly, encoded in a format
 * this does not recognise, or simply corrupt — resolves to "no answer" rather
 * than to a guess. The caller then behaves exactly as it did before this file
 * existed: it waits for the server.
 *
 * ## Why it is safe to read the payload here
 *
 * This parses the session cookie; it does not trust it. Nothing is authorised
 * on the strength of what comes back — the id is used as a *cache key* and the
 * expiry as a *staleness check*, both of which fail closed. Forging either one
 * buys an attacker the ability to show themselves data already sitting in their
 * own browser's localStorage.
 */

/** `sb-<ref>-auth-token`, and the `.0`/`.1` chunks of a session too big for one cookie. */
const AUTH_TOKEN = /^sb-.+-auth-token$/;
const AUTH_TOKEN_CHUNK = /^sb-.+-auth-token\.(\d+)$/;

/** Written by `@supabase/ssr` in front of a base64url-encoded payload. */
const BASE64_PREFIX = "base64-";

/**
 * The names of the Supabase *session* cookies, as one comparable string.
 *
 * A hint, never the authority. This only has to change when the session does.
 *
 * Deliberately not every `sb-` cookie: the PKCE verifier `@supabase/ssr` writes
 * when a Google sign-in starts is also named `sb-…`, it outlives an abandoned
 * sign-in, and counting it as a session is what once made this check disagree
 * with the server forever — one dynamic request per page view, for the life of
 * the tab, on an app whose pages are static precisely so guests cost nothing.
 */
export function authCookieNames(): string {
  return [...jar().keys()]
    .filter((name) => AUTH_TOKEN.test(name) || AUTH_TOKEN_CHUNK.test(name))
    .sort()
    .join(",");
}

export interface AuthCookieUser {
  /** The `sub` of the session — the id of the account the cookie belongs to. */
  id: string;
  /** Seconds since epoch, from the session's own `expires_at`. */
  expiresAt: number;
}

/**
 * Who the cookie says this browser is, or null if it does not say.
 *
 * Null covers every uninteresting case as well as every broken one: a guest, a
 * server render, a sign-in half finished, a cookie written by a future version
 * of `@supabase/ssr` whose encoding this does not know. The caller must treat
 * all of them the same way — ask the server.
 */
export function readAuthCookieUser(): AuthCookieUser | null {
  const raw = sessionCookieValue();
  if (!raw) return null;

  try {
    const session: unknown = JSON.parse(decodePayload(raw));
    if (typeof session !== "object" || session === null) return null;

    const { user, expires_at: expiresAt } = session as {
      user?: { id?: unknown };
      expires_at?: unknown;
    };
    const id = user?.id;

    if (typeof id !== "string" || id.length === 0) return null;
    if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return null;

    return { id, expiresAt };
  } catch {
    // Not JSON, not base64, or not the shape this expects. See the header: the
    // only correct answer to a cookie we cannot read is that we cannot read it.
    return null;
  }
}

/* ── Internals ─────────────────────────────────────────────────────────── */

function jar(): Map<string, string> {
  const cookies = new Map<string, string>();
  if (typeof document === "undefined") return cookies;

  for (const entry of document.cookie.split("; ")) {
    const eq = entry.indexOf("=");
    // `eq < 1` rather than `=== -1`: a nameless cookie is as useless as none.
    if (eq < 1) continue;
    cookies.set(entry.slice(0, eq), entry.slice(eq + 1));
  }
  return cookies;
}

/**
 * The session cookie, reassembled.
 *
 * A session larger than the 4 kB a cookie holds is split across `.0`, `.1`, …
 * and the halves have to be joined in index order — `document.cookie` makes no
 * promise about the order it lists them in, and a session reassembled backwards
 * is not a session, it is a parse error.
 */
function sessionCookieValue(): string | null {
  const cookies = jar();

  for (const [name, value] of cookies) {
    if (AUTH_TOKEN.test(name)) return value;
  }

  const chunks: { index: number; value: string }[] = [];
  for (const [name, value] of cookies) {
    const match = AUTH_TOKEN_CHUNK.exec(name);
    if (match) chunks.push({ index: Number(match[1]), value });
  }
  if (chunks.length === 0) return null;

  return chunks
    .sort((a, b) => a.index - b.index)
    .map((chunk) => chunk.value)
    .join("");
}

/** Undoes the two encodings that can sit between the cookie and its JSON. */
function decodePayload(raw: string): string {
  let value = raw;
  try {
    value = decodeURIComponent(raw);
  } catch {
    // A stray `%` in the value. base64url does not produce one, so the raw
    // string is the better guess.
  }

  if (!value.startsWith(BASE64_PREFIX)) return value;

  const encoded = value.slice(BASE64_PREFIX.length);
  const padded = encoded
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(encoded.length / 4) * 4, "=");

  // `atob` yields one character per byte, not per code point, so a name with an
  // accent in it comes back mangled unless the bytes are decoded as UTF-8. The
  // id and the expiry are both ASCII, but `JSON.parse` sees the whole document
  // and would throw on the mangling long before reaching them.
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
