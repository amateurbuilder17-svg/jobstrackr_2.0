import { beforeEach, describe, expect, it, vi } from "vitest";

import { authCookieNames, readAuthCookieUser } from "./auth-cookie";

/**
 * Reading the session cookie is a guess at what the server will confirm, so
 * these tests are mostly about the guesses it must decline to make. A cookie it
 * cannot parse, one belonging to a half-finished sign-in, one chunked across
 * two entries — the only acceptable answers are the right user or no user.
 */

const REF = "sb-abcdefghij-auth-token";

function setCookies(cookies: Record<string, string>): void {
  const serialised = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
  vi.stubGlobal("document", { cookie: serialised });
}

/** Encoded the way `@supabase/ssr` writes it: `base64-` then base64url JSON. */
function encodeSession(session: unknown): string {
  return `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

const SESSION = {
  access_token: "jwt.goes.here",
  expires_at: 1_800_000_000,
  user: { id: "8ec4a1f0-0000-4000-8000-000000000001", email: "asha@example.com" },
};

beforeEach(() => {
  setCookies({});
});

describe("authCookieNames", () => {
  it("names the session cookies, and nothing else", () => {
    setCookies({
      theme: "dark",
      [REF]: "anything",
      "sb-abcdefghij-auth-token-code-verifier": "pkce",
    });
    expect(authCookieNames()).toBe(REF);
  });

  it("is stable whatever order the browser lists the chunks in", () => {
    setCookies({ [`${REF}.1`]: "b", [`${REF}.0`]: "a" });
    const first = authCookieNames();
    setCookies({ [`${REF}.0`]: "a", [`${REF}.1`]: "b" });
    expect(authCookieNames()).toBe(first);
  });

  it("changes when the session does, which is the only thing it is for", () => {
    setCookies({ [REF]: "one" });
    const signedIn = authCookieNames();
    setCookies({});
    expect(authCookieNames()).not.toBe(signedIn);
  });

  it("is empty during a server render", () => {
    vi.stubGlobal("document", undefined);
    expect(authCookieNames()).toBe("");
  });
});

describe("readAuthCookieUser", () => {
  it("reads the account and its expiry out of the cookie", () => {
    setCookies({ [REF]: encodeSession(SESSION) });
    expect(readAuthCookieUser()).toEqual({
      id: SESSION.user.id,
      expiresAt: SESSION.expires_at,
    });
  });

  it("reassembles a session split across chunks, in index order", () => {
    const encoded = encodeSession(SESSION);
    const cut = Math.floor(encoded.length / 2);
    // Deliberately listed with the later chunk first: `document.cookie` makes
    // no promise about order, and a session reassembled backwards is garbage.
    setCookies({
      [`${REF}.1`]: encoded.slice(cut),
      [`${REF}.0`]: encoded.slice(0, cut),
    });
    expect(readAuthCookieUser()?.id).toBe(SESSION.user.id);
  });

  it("survives a name that is not ASCII", () => {
    setCookies({
      [REF]: encodeSession({ ...SESSION, user: { ...SESSION.user, name: "आशा" } }),
    });
    expect(readAuthCookieUser()?.id).toBe(SESSION.user.id);
  });

  it("reads a payload stored as plain JSON, without the base64 prefix", () => {
    setCookies({ [REF]: JSON.stringify(SESSION) });
    expect(readAuthCookieUser()?.id).toBe(SESSION.user.id);
  });

  it("reads a payload the browser percent-encoded", () => {
    setCookies({ [REF]: encodeURIComponent(JSON.stringify(SESSION)) });
    expect(readAuthCookieUser()?.id).toBe(SESSION.user.id);
  });

  it("is null for a guest", () => {
    setCookies({ theme: "dark" });
    expect(readAuthCookieUser()).toBeNull();
  });

  it("ignores the PKCE verifier an abandoned Google sign-in leaves behind", () => {
    setCookies({ "sb-abcdefghij-auth-token-code-verifier": encodeSession(SESSION) });
    expect(readAuthCookieUser()).toBeNull();
  });

  it.each([
    ["a cookie that is not base64", "base64-!!!!"],
    ["base64 that is not JSON", `base64-${Buffer.from("hello").toString("base64url")}`],
    ["a session with no user", encodeSession({ expires_at: 1 })],
    ["a user with no id", encodeSession({ expires_at: 1, user: {} })],
    ["an id that is not a string", encodeSession({ expires_at: 1, user: { id: 7 } })],
    ["an empty id", encodeSession({ expires_at: 1, user: { id: "" } })],
    ["no expiry", encodeSession({ user: { id: "x" } })],
    [
      "an expiry that is not a number",
      encodeSession({ expires_at: "soon", user: { id: "x" } }),
    ],
  ])("is null for %s", (_label, value) => {
    setCookies({ [REF]: value });
    expect(readAuthCookieUser()).toBeNull();
  });

  it("is null during a server render", () => {
    vi.stubGlobal("document", undefined);
    expect(readAuthCookieUser()).toBeNull();
  });
});
