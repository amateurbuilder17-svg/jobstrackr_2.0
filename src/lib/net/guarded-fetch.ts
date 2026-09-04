/**
 * The one door every browser-side request goes through.
 *
 * The failure this exists for is not a bug in any single caller. It is the
 * shape they all share: a component asks for a URL, the answer never comes,
 * and something — an observer that re-fires, a navigation that re-checks, a
 * person pressing a button — asks again. When the server is up, that is a
 * retry. When the server is down, it is a client that hammers a dead endpoint
 * for as long as the tab is open, on a plan whose ceilings are counted in
 * `scripts/check-traffic-budget.mjs`.
 *
 * So three guards, in the order they take effect:
 *
 *   1. **A deadline.** A request that has not answered in `timeoutMs` is
 *      aborted. "Down" is rarely a refused connection; far more often it is a
 *      socket that stays open and never replies, and a `fetch` with no signal
 *      waits on that forever. Everything downstream — the retry cap, the
 *      breaker, the spinner that stops spinning — depends on failing at all.
 *
 *   2. **A retry cap.** At most `retries` further attempts, spaced by
 *      exponential backoff with jitter, and only for failures a retry could
 *      plausibly fix: a dropped connection, a 5xx, a 429 that names its wait.
 *      A 404 or a 400 is the server working correctly and saying no; repeating
 *      it is pure waste. Non-GET requests default to zero retries, because a
 *      request that may already have been applied is not ours to send twice.
 *
 *   3. **A circuit breaker**, and this is the actual answer to "do not fetch
 *      it forever". Three consecutive failed calls to an endpoint and the
 *      circuit opens: every further call fails instantly, in memory, without
 *      touching the network, for a cooldown that doubles with each further
 *      failure up to five minutes. A held-down button, a re-firing observer
 *      and a navigation loop all cost one request per cooldown instead of one
 *      per event. One success closes it and forgets the history.
 *
 * The breaker is per tab and per endpoint, which is the right scope: it is
 * protecting this browser from its own retry pressure, and `/api/jobs` being
 * dead says nothing about `/api/session`.
 */

/** Per attempt, not per call. Three attempts can take three times this. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** First backoff, doubled per retry. Jittered so N tabs do not resynchronise. */
const BACKOFF_BASE_MS = 400;
const BACKOFF_MAX_MS = 4_000;

/** Consecutive failed calls that open the circuit. */
const TRIP_AFTER = 3;

/** First cooldown, doubled on each failure while open, to a ceiling. */
const COOLDOWN_START_MS = 15_000;
const COOLDOWN_MAX_MS = 5 * 60_000;

/** Stops the map growing without bound in a long-lived tab. */
const MAX_CIRCUITS = 100;

export type FailureReason =
  /** The circuit for this endpoint is open. Nothing was sent. */
  | "circuit-open"
  /** The attempt passed its deadline. */
  | "timeout"
  /** Connection refused, DNS failure, offline — fetch itself rejected. */
  | "network"
  /** A response arrived, and it was not one we accept. */
  | "http";

export class FetchGuardError extends Error {
  readonly reason: FailureReason;
  readonly status: number | undefined;
  /** Milliseconds until this endpoint is worth trying again. Zero when now. */
  readonly retryInMs: number;

  constructor(reason: FailureReason, message: string, status?: number, retryInMs = 0) {
    super(message);
    this.name = "FetchGuardError";
    this.reason = reason;
    this.status = status;
    this.retryInMs = retryInMs;
  }
}

interface Circuit {
  /** Consecutive failed calls. Reset to zero by any success. */
  failures: number;
  /** Epoch ms before which calls are refused outright. */
  openUntil: number;
  /** The next cooldown to apply, doubling while failures continue. */
  cooldownMs: number;
}

const circuits = new Map<string, Circuit>();

/**
 * Which endpoint a URL belongs to.
 *
 * The path without its query, so `/api/jobs?state=bihar` and `/api/jobs?page=2`
 * share a breaker. They share a server and a database; a query string is not a
 * second opinion about whether the thing behind them is up.
 */
function circuitKeyFor(url: string): string {
  try {
    return new URL(url, typeof location === "undefined" ? "http://x" : location.href).pathname;
  } catch {
    return url;
  }
}

function circuitFor(key: string): Circuit {
  const existing = circuits.get(key);
  if (existing) return existing;

  if (circuits.size >= MAX_CIRCUITS) {
    // Same reasoning as the rate limiter's bucket map: evicting by age would
    // need an ordered structure for a map that should never reach this size.
    // Dropping everything costs at most one extra request per live endpoint.
    circuits.clear();
  }

  const fresh: Circuit = { failures: 0, openUntil: 0, cooldownMs: COOLDOWN_START_MS };
  circuits.set(key, fresh);
  return fresh;
}

/**
 * How long this endpoint should be left alone. Zero when it is fair game.
 *
 * Exported because a Retry button that is offered while the circuit is open is
 * a lie — the press cannot reach the network. Callers use this to say when,
 * rather than inviting a click that does nothing.
 */
export function retryDelayMs(url: string): number {
  const circuit = circuits.get(circuitKeyFor(url));
  if (!circuit) return 0;
  return Math.max(0, circuit.openUntil - Date.now());
}

function recordSuccess(key: string): void {
  // Deleted rather than zeroed: a healthy endpoint should not hold a row, and
  // the next failure starts from the shortest cooldown rather than the last
  // outage's escalated one.
  circuits.delete(key);
}

function recordFailure(key: string): number {
  const circuit = circuitFor(key);
  circuit.failures += 1;

  if (circuit.failures < TRIP_AFTER) return 0;

  circuit.openUntil = Date.now() + circuit.cooldownMs;
  const applied = circuit.cooldownMs;
  // Escalate for next time. An endpoint that has been down for ten minutes is
  // not likely to be back in fifteen seconds, and asking costs a request.
  circuit.cooldownMs = Math.min(circuit.cooldownMs * 2, COOLDOWN_MAX_MS);
  return applied;
}

/**
 * Take a server at its word about when to come back.
 *
 * A `Retry-After` longer than the cooldown the breaker worked out is the
 * server saying it knows better, and it does.
 */
function holdFor(key: string, ms: number): void {
  const circuit = circuitFor(key);
  circuit.openUntil = Math.max(circuit.openUntil, Date.now() + ms);
}

/** Forgets every circuit. For tests, and for the `online` event. */
export function resetCircuits(): void {
  circuits.clear();
}

/**
 * The network came back. Whatever the breaker learned while the radio was off
 * was about this device, not about the server, so it is not worth honouring —
 * a person who reconnects and pulls to refresh should not wait out a cooldown
 * earned by being in a tunnel.
 */
if (typeof window !== "undefined") {
  window.addEventListener("online", resetCircuits);
}

/** Is this worth sending again? */
function isRetryable(status: number): boolean {
  // 408 request timeout, 425 too early, 429 too many requests, and the 5xx
  // family. Everything else in 4xx is a considered refusal.
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

/**
 * A 429 or 503 may name its own wait. Honour it over our backoff when it is
 * longer, and ignore an absurd one — a header is not permission to hang.
 */
function retryAfterMs(response: Response): number | null {
  const header = response.headers.get("Retry-After");
  if (!header) return null;

  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(seconds * 1000, COOLDOWN_MAX_MS);

  const date = Date.parse(header);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(0, date - Date.now()), COOLDOWN_MAX_MS);
}

function backoffMs(attempt: number): number {
  const base = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS);
  // ±25% jitter. Twenty tabs that failed on the same outage must not all come
  // back in the same millisecond.
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export interface GuardedFetchOptions extends RequestInit {
  /** Deadline for each attempt. Raise it for anything genuinely slow. */
  timeoutMs?: number;
  /**
   * Attempts after the first. Defaults to 2 for GET and 0 for everything
   * else — a POST that timed out may already have been applied.
   */
  retries?: number;
  /**
   * Share a breaker with other URLs, or keep a separate one. Defaults to the
   * path, which is almost always what is wanted.
   */
  circuitKey?: string;
}

/**
 * `fetch`, with a deadline, a retry cap and a circuit breaker.
 *
 * Resolves with the `Response` for any status the server actually chose to
 * return — a 404 is an answer, and the caller decides what it means. Throws
 * `FetchGuardError` when no answer was reached: the circuit was open, the
 * attempts ran out, or the deadline passed. A caller-triggered abort still
 * throws the usual `AbortError` and is never counted against the breaker.
 */
export async function guardedFetch(
  url: string,
  options: GuardedFetchOptions = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries,
    circuitKey,
    signal: callerSignal,
    ...init
  } = options;

  const method = (init.method ?? "GET").toUpperCase();
  const maxRetries = retries ?? (method === "GET" || method === "HEAD" ? 2 : 0);
  const key = circuitKey ?? circuitKeyFor(url);

  const openFor = retryDelayMs(url);
  if (openFor > 0) {
    throw new FetchGuardError(
      "circuit-open",
      `Not contacting ${key} — it failed ${String(TRIP_AFTER)} times in a row.`,
      undefined,
      openFor,
    );
  }

  // Read through a call rather than directly. After one `if (signal.aborted)`
  // the compiler narrows the property to `false` for the rest of the function
  // and flags every later check as dead code — but an abort can land during
  // any of the awaits below, so those checks are the real ones. The same trick
  // `SessionProvider` uses, for the same reason.
  const callerAborted = () => callerSignal?.aborted === true;

  let last: FetchGuardError = new FetchGuardError("network", `Could not reach ${key}.`);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (callerAborted()) throw new DOMException("Aborted", "AbortError");

    // Composed by hand rather than with `AbortSignal.any`, which is too new to
    // rely on for the phones this app is actually opened on.
    const controller = new AbortController();
    let timedOut = false;
    // Read through a call for the same narrowing reason as `callerAborted`:
    // the only assignment is inside the timer's callback, so the compiler
    // believes this is still `false` by the time the catch block reads it.
    const didTimeOut = () => timedOut;

    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const relay = () => {
      controller.abort();
    };
    callerSignal?.addEventListener("abort", relay, { once: true });

    try {
      const response = await fetch(url, { ...init, signal: controller.signal });

      if (!isRetryable(response.status)) {
        // Includes every 4xx that is not a rate limit. The server answered, so
        // it is up, whatever it thinks of the request.
        recordSuccess(key);
        return response;
      }

      const named = retryAfterMs(response);

      if (attempt < maxRetries) {
        await sleep(Math.max(named ?? 0, backoffMs(attempt)), callerSignal);
        continue;
      }

      // Out of attempts, but the server did answer — a 503 with a message in
      // it, a 429 naming its wait. That is information the caller asked for
      // and can render, so it goes back rather than becoming an exception.
      // The breaker still counts it: answering "no, I am overloaded" three
      // times running is exactly the case for leaving an endpoint alone.
      recordFailure(key);
      if (named !== null) holdFor(key, named);
      return response;
    } catch {
      // The caller pulled the plug — a newer keystroke, an unmounted
      // component. Not a failure of the server and not the breaker's business.
      if (callerAborted()) throw new DOMException("Aborted", "AbortError");

      last = didTimeOut()
        ? new FetchGuardError("timeout", `${key} did not answer within ${String(timeoutMs)}ms.`)
        : new FetchGuardError("network", `Could not reach ${key}.`);

      if (attempt < maxRetries) {
        await sleep(backoffMs(attempt), callerSignal);
        continue;
      }
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener("abort", relay);
    }
  }

  // Every attempt for this call is spent without an answer. That counts as one
  // failure against the endpoint, not one per attempt — the retry cap has
  // already been paid.
  const cooldown = recordFailure(key);
  throw new FetchGuardError(last.reason, last.message, last.status, cooldown);
}

/**
 * `guardedFetch` plus "the body must be JSON and the status must be ok".
 *
 * Most callers want exactly this and were each writing their own `if (!res.ok)
 * throw`. Failures arrive as `FetchGuardError` either way, so one `catch` can
 * tell "we never reached it" from "it said no".
 */
export async function guardedJson<T>(url: string, options?: GuardedFetchOptions): Promise<T> {
  const response = await guardedFetch(url, options);

  if (!response.ok) {
    throw new FetchGuardError(
      "http",
      `${circuitKeyFor(url)} returned ${String(response.status)}.`,
      response.status,
    );
  }

  return (await response.json()) as T;
}
