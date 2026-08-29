import "server-only";

import type { StatusSource } from "@/lib/exams/report";
import {
  loadApiKeys,
  recordDeadKey,
  recordError,
  recordRateLimit,
  recordSuccess,
  recordUnsupportedModel,
  servesItsModel,
  type ApiKey,
} from "./keys";

/**
 * One call to Gemini, with Google Search grounding, over a rotating key pool.
 *
 * ## Why grounding is the whole point
 *
 * The question this app asks — "is the SSC CGL admit card out yet?" — is about
 * this week. A model answering from its weights answers about its training
 * cutoff, fluently and with total confidence, which is the worst possible
 * failure mode for a page someone checks before booking a train to an exam
 * centre. `tools: [{ google_search: {} }]` makes the model search first and
 * answer from what it found, and returns the pages it used so the answer can be
 * shown with its sources attached.
 *
 * When grounding is unavailable the call is retried without it, and the result
 * is flagged `grounded: false` all the way to the screen. A weaker answer,
 * clearly labelled, beats an error page — but it must never be mistaken for the
 * strong one.
 *
 * ## Why the keys rotate
 *
 * Gemini 3.5 Flash is free, and free means capped: requests per minute, tokens
 * per minute, requests per day, each enforced with a `429`. A single key is
 * therefore a hard ceiling on how many people can ask at once. The pool is the
 * answer, and `keys.ts` owns it — which key to try next, and what to write down
 * about what happened. This module's job is to walk that list and stop at the
 * first key that answers.
 */

/* ── Configuration ─────────────────────────────────────────────────────── */

/**
 * Per-attempt timeout.
 *
 * A grounded call does a real web search before it generates, so it is slow.
 * Measured against a live key on this app's own prompt: 25–35 seconds, not the
 * 8–15 the first version of this comment assumed. At 25s the timeout was
 * cutting off calls that would have succeeded, so the pool rotated to the next
 * key and paid for the same slow call again.
 *
 * Paired with `START_CUTOFF_MS` in the cron: 25s cutoff + 30s attempt = 55s,
 * inside Vercel Hobby's 60-second ceiling.
 */
const TIMEOUT_MS = 30_000;

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/* ── Request and response ──────────────────────────────────────────────── */

export interface GenerateRequest {
  system: string;
  prompt: string;
  temperature?: number;
  maxTokens?: number;
  /** Defaults to true. The only caller that would set false is a retry. */
  grounded?: boolean;
}

export interface GenerateResult {
  text: string;
  sources: StatusSource[];
  grounded: boolean;
  model: string;
  /** True when the model ran out of output tokens mid-answer. */
  truncated: boolean;
}

export class GeminiError extends Error {
  constructor(
    message: string,
    /** True when every key was rate-limited rather than broken. */
    readonly exhausted = false,
    /**
     * True when the pool is empty or Google refused every key in it.
     *
     * The distinction from a plain failure is what the caller tells the person
     * waiting. "Try again shortly" is right for a timeout and wrong for a
     * revoked key: nothing about waiting fixes it, and each retry costs a
     * quota claim to rediscover the same refusal.
     */
    readonly unusable = false,
  ) {
    super(message);
    this.name = "GeminiError";
  }
}

/** Whether this deployment can answer at all. Checked before anything is spent. */
export async function hasApiKeys(): Promise<boolean> {
  return (await loadApiKeys()).length > 0;
}

interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
    groundingMetadata?: {
      groundingChunks?: { web?: { uri?: string; title?: string } }[];
    };
  }[];
}

/**
 * The pages the model actually consulted.
 *
 * The URIs are Google's redirect wrappers rather than the publisher's own
 * links, which is not ideal but is what grounding returns; the title is
 * usually the domain, which is the part a reader checks. Deduplicated by URI
 * and capped, because a grounded answer routinely cites the same aggregator
 * six times and a wall of identical chips is not attribution.
 */
function extractSources(data: GeminiResponse): StatusSource[] {
  const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
  const seen = new Set<string>();
  const sources: StatusSource[] = [];

  for (const chunk of chunks) {
    const url = chunk.web?.uri;
    if (!url || seen.has(url)) continue;
    if (!url.startsWith("https://")) continue;
    seen.add(url);
    sources.push({ title: chunk.web?.title?.trim() ?? "Source", url });
    if (sources.length >= 6) break;
  }

  return sources;
}

/**
 * A 400 that is about the key rather than about the request.
 *
 * Matched on the error body because the status code does not distinguish them:
 * a bad model name and a bad key are both 400, and disabling a key over the
 * former would empty a working pool one call at a time.
 */
function isInvalidKey(detail: string): boolean {
  return /API_KEY_INVALID|API key not valid|API key expired/i.test(detail);
}

/**
 * A 404 that means "not this key, not this model".
 *
 * Google closes a model to new projects rather than removing it, so a key
 * created last week is refused `gemini-2.5-flash` — "no longer available to
 * new users" — while the eight keys beside it keep using it happily. Left
 * unclassified this is a generic error: recorded, never disabled, and retried
 * on every request forever, one wasted round trip at a time.
 *
 * A model name that is simply wrong lands here too ("is not found for API
 * version v1beta"), and that is correct rather than sloppy: every key will be
 * refused it, the walk ends with nothing usable, and the caller is told the
 * deployment is misconfigured — which is exactly what a bad model name is.
 */
function isModelRefused(status: number, detail: string): boolean {
  if (status !== 404) return false;
  return /no longer available|not available|is not found|not supported/i.test(detail);
}

/**
 * Finish reasons no other key will do any better on.
 *
 * These describe the *request* — the model mangled its own structured output,
 * or a safety filter stopped it — not the key that carried it. Rotating through
 * them is the expensive mistake: with ten keys in the pool, one
 * MALFORMED_FUNCTION_CALL would spend ten API calls, on every single request,
 * to arrive at the same answer ten times.
 *
 * Measured, not guessed. `gemini-3.5-flash` answering this app's JSON contract
 * returns `MALFORMED_FUNCTION_CALL` with zero text and ~300 thinking tokens,
 * and raising maxOutputTokens from 4,096 to 16,384 changes nothing.
 */
const DETERMINISTIC_STOPS = new Set([
  "MALFORMED_FUNCTION_CALL",
  "SAFETY",
  "RECITATION",
  "PROHIBITED_CONTENT",
  "BLOCKLIST",
  "SPII",
]);

function extractText(data: GeminiResponse): string {
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((p) => p.text ?? "")
    .join("")
    .trim();
}

/* ── The call ──────────────────────────────────────────────────────────── */

async function callOnce(
  key: ApiKey,
  req: GenerateRequest,
  grounded: boolean,
): Promise<Response> {
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents: [{ role: "user", parts: [{ text: req.prompt }] }],
    generationConfig: {
      temperature: req.temperature ?? 0.2,
      maxOutputTokens: req.maxTokens ?? 4096,
    },
  };

  // Note the absence of `responseMimeType: "application/json"`. The v1beta API
  // rejects structured output and the search tool in the same request, so the
  // JSON contract is stated in the prompt and enforced by the parser instead.
  // That is not a preference — asking for both is a 400.
  if (grounded) body.tools = [{ google_search: {} }];

  // The key travels in a header, not in `?key=`. Google accepts both, and the
  // query form is the one that ends up somewhere it should not be: request
  // URLs are what proxies log, what error reporters attach to a breadcrumb,
  // and what a stack trace quotes back. A header is not automatically captured
  // by any of those. Same call, same auth, one fewer place the secret leaks.
  return fetch(`${ENDPOINT}/${encodeURIComponent(key.model)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key.key },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

/**
 * Walk the pool until one key answers.
 *
 * `exhausted` is tracked separately from "failed", and the distinction matters
 * upstream: every key being rate-limited is a wait-and-retry, while a key
 * rejecting the request is something a retry will reproduce exactly.
 */
async function attempt(
  keys: ApiKey[],
  req: GenerateRequest,
  grounded: boolean,
): Promise<GenerateResult> {
  if (keys.length === 0) {
    throw new GeminiError("No Gemini API key is configured.", false, true);
  }

  let lastError = "every key failed";
  let allExhausted = true;
  // Until something says otherwise, assume the worst kind of failure: a pool
  // Google will refuse just as flatly on the next request.
  let allInvalid = true;

  for (const [index, key] of keys.entries()) {
    // Already proven, in this process, to be a pairing Google refuses. Skipped
    // rather than re-proven — but `allInvalid` is left standing, because a pool
    // where no key may use its model is a deployment problem, not a bad moment.
    if (!servesItsModel(key)) {
      allExhausted = false;
      lastError = `${key.label} may not use ${key.model}`;
      continue;
    }

    let response: Response;

    try {
      response = await callOnce(key, req, grounded);
    } catch (error) {
      // A timeout or a network failure. Not this key's fault as far as anyone
      // can tell, so nothing is written against it — but the next key gets a
      // turn, because a hung region is a real thing.
      allExhausted = false;
      allInvalid = false;
      lastError = error instanceof Error ? error.message : "network error";
      continue;
    }

    if (response.ok) {
      const data = (await response.json()) as GeminiResponse;
      const text = extractText(data);

      if (text === "") {
        const stop = data.candidates?.[0]?.finishReason ?? "unknown";

        // Not this key's fault, and not fixable by trying another one. Stop
        // here rather than spending the rest of the pool proving it.
        if (DETERMINISTIC_STOPS.has(stop)) {
          throw new GeminiError(
            `the model returned no text (${stop}) — the pool cannot fix this, ` +
              `the model or the prompt has to change`,
          );
        }

        // Empty for some other reason. Charged against the key, so one that is
        // consistently empty shows up in the counters, and rotate on.
        allExhausted = false;
        allInvalid = false;
        lastError = `the model returned an empty answer (${stop})`;
        recordError(key, 200, `empty answer (${stop})`);
        continue;
      }

      recordSuccess(key);

      // Only when the pool was actually consumed. The first key answering is
      // the normal case and logging it would bury the times it did not — and
      // this codebase logs failures, not traffic.
      if (index > 0) {
        console.warn(
          `[gemini] key 1 of ${String(keys.length)} did not answer; key ${String(index + 1)} did`,
        );
      }

      return {
        text,
        sources: extractSources(data),
        grounded,
        model: key.model,
        truncated: data.candidates?.[0]?.finishReason === "MAX_TOKENS",
      };
    }

    const detail = (await response.text().catch(() => "")).slice(0, 300);

    // 429 is the free tier's per-minute or per-day cap; 402 is a spent paid
    // quota. Both mean "this key, later" rather than "this key, never", so the
    // key goes on cooldown and stays in the pool.
    if (response.status === 429 || response.status === 402) {
      recordRateLimit(key, response.status);
      // A capped key is a working key. Whatever else this call reports, it is
      // not a deployment that cannot answer.
      allInvalid = false;
      lastError = "every key is rate limited";
      continue;
    }

    allExhausted = false;

    // Revoked, restricted, or never valid. Switched off, so it stops costing
    // every future request an attempt.
    //
    // The 400 case is the one the old project missed. Google answers a key that
    // was mistyped, deleted, or restricted to the wrong API with
    // `400 API_KEY_INVALID`, not a 401 — so a single bad row in a pool of ten
    // was retried on every request forever, and the only symptom was every
    // refresh being one round trip slower than it needed to be.
    if (response.status === 401 || response.status === 403 || isInvalidKey(detail)) {
      recordDeadKey(key, response.status, detail);
      lastError = `key ${key.label} is invalid or blocked (${String(response.status)})`;
      console.warn(`[gemini] disabled ${key.label}: ${String(response.status)} ${detail}`);
      continue;
    }

    // A model this key's project may not use. Remembered as a pairing so the
    // rest of the pool — and this same key on another model — is unaffected.
    if (isModelRefused(response.status, detail)) {
      recordUnsupportedModel(key, response.status, detail);
      lastError = `${key.label} may not use ${key.model}`;
      continue;
    }

    // Everything else: an unsupported tool combination, a 500 from Google.
    // Recorded and rotated past — the next key may well work.
    recordError(key, response.status, detail);
    allInvalid = false;
    lastError = `API error ${String(response.status)}: ${detail.slice(0, 200)}`;
    console.warn(`[gemini] ${key.model} ${String(response.status)}: ${detail}`);
  }

  throw new GeminiError(lastError, allExhausted, allInvalid);
}

/**
 * Generate, grounded, with one ungrounded retry.
 *
 * The retry exists because grounding is the part most likely to be refused —
 * some key tiers do not carry the tool, and the failure arrives as a 400 on
 * every key rather than as a feature flag. Falling back gets an answer on
 * screen; the `grounded: false` on it is what stops that answer being read as
 * more than it is.
 *
 * The pool is loaded once and reused for the retry. Reloading would re-read the
 * cooldowns this very call just wrote, and put the whole pool at the back of
 * its own queue.
 */
export async function generate(req: GenerateRequest): Promise<GenerateResult> {
  const keys = await loadApiKeys();
  const wantsGrounding = req.grounded ?? true;

  try {
    return await attempt(keys, req, wantsGrounding);
  } catch (error) {
    const failure = error instanceof GeminiError ? error : new GeminiError(String(error));

    if (!wantsGrounding) throw failure;

    // A pool Google refused outright will refuse the ungrounded call too — the
    // key is checked before the tools are. Walking it a second time doubles
    // the wait for a failure that is already decided.
    if (failure.unusable) throw failure;

    // Note that an exhausted pool is NOT excluded here, and that is a
    // correction made against a live key rather than a guess. The reasoning
    // used to be "every key being rate-limited says nothing about grounding,
    // so retrying spends the same spent keys again". That is wrong: grounding
    // carries its own quota, separate from generation. Measured on a fresh
    // free-tier key with zero calls against it, `gemini-3.5-flash` returned
    // 429 RESOURCE_EXHAUSTED for a grounded request and answered the identical
    // ungrounded request immediately.
    //
    // So a 429 is one of the strongest reasons to try without the tool, not a
    // reason to give up. The answer that comes back is weaker and is labelled
    // `grounded: false` all the way to the badge that says "Not searched".
    if (failure.exhausted) {
      console.warn("[gemini] grounded quota exhausted; falling back to an ungrounded answer");
    }

    console.warn(`[gemini] grounded call failed (${failure.message}); retrying ungrounded`);
    return attempt(keys, req, false);
  }
}
