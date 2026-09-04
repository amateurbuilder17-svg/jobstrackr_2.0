import "server-only";

import { createSign } from "node:crypto";

import { REQUEST_TIMEOUT_MS } from "./targets";

/**
 * Google's Indexing API.
 *
 * The only push channel Google offers, and it is deliberately narrow: Google
 * sanctions it for pages carrying `JobPosting` or `BroadcastEvent` structured
 * data. This site is a board of government job notifications, so `/jobs/*` is
 * squarely inside that — but see `eligibleFor` in `targets.ts` for why nothing
 * else is ever submitted here. Access is revocable and the revocation would be
 * silent.
 *
 * ── Why there is no googleapis dependency ──────────────────────────────────
 * The official client is ~15 MB of transitive dependencies to sign a JWT and
 * make two POSTs. The whole of the auth flow is below: build a claim set, sign
 * it with the service account's RSA key, exchange it for an access token. That
 * is a hundred lines against a bundle that would be the largest thing in the
 * serverless function.
 */

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const PUBLISH_ENDPOINT = "https://indexing.googleapis.com/v3/urlNotifications:publish";
const SCOPE = "https://www.googleapis.com/auth/indexing";

export interface GoogleIndexingConfig {
  clientEmail: string;
  /** The service account's PEM private key. */
  privateKey: string;
}

export interface PublishResult {
  url: string;
  ok: boolean;
  status: number;
  error?: string;
}

/**
 * Environment variables cannot hold real newlines in most dashboards, so a PEM
 * pasted into Vercel arrives with the line breaks escaped as the two characters
 * `\` and `n`. Signing with that fails with an opaque OpenSSL error about the
 * key format, which is a miserable thing to debug at the point of use.
 */
export function normalizePrivateKey(raw: string): string {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

/**
 * A signed service-account assertion.
 *
 * Exported for the test: the signature cannot be asserted against a fixture
 * without a fixed key, but the header and claim set can, and those are where
 * the mistakes live — a wrong `aud` or a missing `scope` produces a 400 from
 * the token endpoint with no indication which field was wrong.
 */
export function buildAssertion(config: GoogleIndexingConfig, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: config.clientEmail,
      scope: SCOPE,
      aud: TOKEN_ENDPOINT,
      iat: nowSeconds,
      // One hour is Google's maximum. The token is cached below, so this is
      // how often a warm function pays for the round trip — roughly never.
      exp: nowSeconds + 3600,
    }),
  );

  const signingInput = `${header}.${claims}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .sign(normalizePrivateKey(config.privateKey))
    .toString("base64url");

  return `${signingInput}.${signature}`;
}

/**
 * Cached per process, keyed by the account it was issued for.
 *
 * A warm lambda handles many ingest runs; fetching a fresh token for each of
 * them would triple the outbound calls this worker makes for no benefit. The
 * 60-second margin is so a token never expires between being read here and
 * being used a moment later.
 */
let cachedToken: { key: string; token: string; expiresAt: number } | undefined;

async function accessToken(config: GoogleIndexingConfig): Promise<string> {
  const now = Date.now();
  if (cachedToken?.key === config.clientEmail && cachedToken.expiresAt > now) {
    return cachedToken.token;
  }

  const assertion = buildAssertion(config, Math.floor(now / 1000));

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `token exchange failed (${String(response.status)}): ${body.slice(0, 200)}`,
    );
  }

  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("token exchange returned no access_token");

  cachedToken = {
    key: config.clientEmail,
    token: json.access_token,
    expiresAt: now + ((json.expires_in ?? 3600) - 60) * 1000,
  };

  return json.access_token;
}

/**
 * Notify Google that one URL changed.
 *
 * `URL_UPDATED` covers both a new posting and an edit to an existing one —
 * there is no separate "created". `URL_DELETED` is not sent from here: a job
 * whose window shuts becomes `closed` rather than disappearing, and the page
 * stays up as a record of what was advertised. Telling Google to drop a URL
 * that still returns 200 is a request it is right to ignore.
 */
async function publishOne(token: string, url: string): Promise<PublishResult> {
  try {
    const response = await fetch(PUBLISH_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ url, type: "URL_UPDATED" }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (response.ok) return { url, ok: true, status: response.status };

    const body = await response.text().catch(() => "");
    return { url, ok: false, status: response.status, error: body.slice(0, 300) };
  } catch (error) {
    return {
      url,
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Submit a batch, sequentially.
 *
 * Not parallel, and that is deliberate. The batch is at most a handful of URLs
 * (`CAPS.googlePerRun`), the endpoint rate-limits per project rather than per
 * connection, and a `deadline` check between calls is what lets the worker stop
 * cleanly when it has spent its share of the invocation. Concurrency would buy
 * a second and cost the ability to stop.
 */
export async function submitToGoogle(
  config: GoogleIndexingConfig,
  urls: readonly string[],
  deadline: number,
): Promise<{ results: PublishResult[]; authError?: string }> {
  if (urls.length === 0) return { results: [] };

  let token: string;
  try {
    token = await accessToken(config);
  } catch (error) {
    // An auth failure is not a per-URL failure and must not be recorded as
    // one: nothing was submitted, so nothing should be marked as tried and the
    // watermark must not move.
    return { results: [], authError: error instanceof Error ? error.message : String(error) };
  }

  const results: PublishResult[] = [];
  for (const url of urls) {
    if (Date.now() > deadline) break;
    results.push(await publishOne(token, url));
  }

  return { results };
}

/** Test seam: the module-level token cache outlives a single test otherwise. */
export function resetTokenCacheForTests(): void {
  cachedToken = undefined;
}
