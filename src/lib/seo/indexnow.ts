import "server-only";

import { REQUEST_TIMEOUT_MS } from "./targets";

/**
 * IndexNow.
 *
 * One POST tells Bing, Yandex, Seznam and Naver that a set of URLs changed.
 * There is no account, no OAuth and no quota — ownership is proved by serving
 * the key back from the host itself, which is what `/api/seo/indexnow-key`
 * plus the rewrite in `next.config.ts` exist for.
 *
 * This is the row in the table that buys AI-assistant visibility. ChatGPT's
 * search answers from Bing's index; Copilot is Bing outright. A job page that
 * Bing learns about within the hour is a job page an assistant can cite the
 * same day, and there is no separate "submit to ChatGPT" endpoint to call —
 * this is it.
 *
 * Submitting to `api.indexnow.org` rather than to `bing.com/indexnow`
 * directly: the shared endpoint fans the notification out to every
 * participating engine, so one call reaches all of them and adding an engine
 * later costs nothing here.
 */

const ENDPOINT = "https://api.indexnow.org/indexnow";

export interface IndexNowConfig {
  /** The site origin, e.g. `https://jobstrackr.in`. */
  siteUrl: string;
  key: string;
}

export interface IndexNowResult {
  ok: boolean;
  status: number;
  /** Present on failure; the response body, truncated. */
  error?: string;
}

/**
 * The request body, built and tested separately from the sending.
 *
 * `host` must be the bare hostname and every URL must be on it — IndexNow
 * answers 422 for a mismatch and rejects the whole batch, not the offending
 * URL, so a single stray absolute URL from another origin would silently cost
 * the entire submission. Filtering happens here rather than being assumed of
 * the caller.
 */
export function indexNowPayload(
  config: IndexNowConfig,
  urls: readonly string[],
): { host: string; key: string; keyLocation: string; urlList: string[] } | null {
  const host = new URL(config.siteUrl).host;

  const urlList = [...new Set(urls)].filter((url) => {
    try {
      return new URL(url).host === host;
    } catch {
      return false;
    }
  });

  if (urlList.length === 0) return null;

  return {
    host,
    key: config.key,
    // Stated explicitly even though the default location is the same file.
    // Being explicit is what lets the key live behind a rewrite rather than as
    // a committed file in `public/`, and a key that is checked into the repo
    // is a key that cannot be rotated without a deploy.
    keyLocation: `${config.siteUrl}/${config.key}.txt`,
    urlList,
  };
}

export async function submitToIndexNow(
  config: IndexNowConfig,
  urls: readonly string[],
): Promise<IndexNowResult> {
  const payload = indexNowPayload(config, urls);
  if (!payload) return { ok: true, status: 204 };

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // 200 and 202 both mean accepted — 202 is "received, key validation
  // pending", which is the normal answer for a host the endpoint has not seen
  // before and is not a failure to retry.
  if (response.status === 200 || response.status === 202) {
    return { ok: true, status: response.status };
  }

  // The body is the only place the reason lives: 403 is a bad or unreachable
  // key file, 422 is a host mismatch, 429 is too many submissions. All three
  // are configuration problems a log line should name rather than a transient
  // failure worth retrying blindly.
  const body = await response.text().catch(() => "");
  return { ok: false, status: response.status, error: body.slice(0, 300) };
}
