import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";

import { buildAssertion, normalizePrivateKey } from "./google-indexing";

/**
 * A throwaway key. The signature itself is not the interesting assertion —
 * `crypto` signs correctly or it does not — but the header and claim set are:
 * a wrong `aud`, a missing `scope` or an `exp` past Google's one-hour ceiling
 * all come back as an opaque 400 from the token endpoint, with no indication
 * of which field was wrong.
 */
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const config = { clientEmail: "indexer@project.iam.gserviceaccount.com", privateKey };

function decodeSegment(jwt: string, index: number): Record<string, unknown> {
  const segment = jwt.split(".")[index] ?? "";
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<
    string,
    unknown
  >;
}

describe("normalizePrivateKey", () => {
  /**
   * The failure this prevents is genuinely hard to read: a PEM pasted into a
   * dashboard arrives with its newlines escaped, and signing with it fails
   * inside OpenSSL with a message about the key format rather than about the
   * newlines.
   */
  it("restores newlines escaped by an environment variable", () => {
    expect(normalizePrivateKey("-----BEGIN-----\\nabc\\n-----END-----")).toBe(
      "-----BEGIN-----\nabc\n-----END-----",
    );
  });

  it("leaves a key with real newlines untouched", () => {
    const real = "-----BEGIN-----\nabc\n-----END-----";
    expect(normalizePrivateKey(real)).toBe(real);
  });
});

describe("buildAssertion", () => {
  const now = 1_800_000_000;
  const jwt = buildAssertion(config, now);

  it("is three base64url segments", () => {
    expect(jwt.split(".")).toHaveLength(3);
  });

  it("declares RS256, which is the only algorithm the token endpoint accepts", () => {
    expect(decodeSegment(jwt, 0)).toEqual({ alg: "RS256", typ: "JWT" });
  });

  it("addresses the token endpoint, not the indexing endpoint", () => {
    // Naming the API here instead of the token endpoint is the single most
    // common mistake in this flow, and it fails with "invalid_grant".
    expect(decodeSegment(jwt, 1).aud).toBe("https://oauth2.googleapis.com/token");
  });

  it("requests only the indexing scope", () => {
    expect(decodeSegment(jwt, 1).scope).toBe("https://www.googleapis.com/auth/indexing");
  });

  it("expires within Google's one-hour ceiling", () => {
    const claims = decodeSegment(jwt, 1);
    expect(claims.iat).toBe(now);
    expect(Number(claims.exp) - Number(claims.iat)).toBeLessThanOrEqual(3600);
  });

  it("signs as the service account", () => {
    expect(decodeSegment(jwt, 1).iss).toBe(config.clientEmail);
  });
});
