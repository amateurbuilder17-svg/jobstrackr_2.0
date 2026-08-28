import "server-only";

/**
 * A token bucket, in process memory.
 *
 * What this is honestly worth: it is per-instance. Two serverless instances
 * mean two buckets and twice the allowance, and a cold start resets it. It is a
 * mitigation, not a guarantee — the guarantee lives in RLS, which is what
 * actually stops someone writing a row they do not own.
 *
 * It is still worth having. The failure it prevents is not a determined
 * attacker; it is a stuck retry loop or a held-down button turning one user
 * into thousands of writes, and for that a per-instance bucket is enough.
 * Redis would make it exact, but this project's Redis has been intermittent
 * (that is why the caching layer keeps an in-process copy too), and an
 * intermittent dependency in the write path buys unreliability, not safety.
 */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

/** Stops the map growing without bound in a long-lived instance. */
const MAX_KEYS = 10_000;

export interface RateLimit {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

/** Sensible defaults per kind of write. Generous — this is a floor, not a quota. */
export const LIMITS = {
  /** Toggling a save. Deliberately high: it is one tap and people are fast. */
  save: { limit: 120, windowMs: 60_000 },
  /** Form submissions — profile, tracker. */
  form: { limit: 30, windowMs: 60_000 },
  /** Anything that sends mail, where the cost is someone else's inbox. */
  email: { limit: 5, windowMs: 60_000 },
  /**
   * A model call.
   *
   * Tighter than the rest because this is the only write whose cost is money
   * and a third party's quota rather than a row. It is deliberately *not* the
   * real ceiling — that is `claim_ai_quota`, in the database, where every
   * instance sees the same counter. This one is the cheap first refusal, so a
   * double-tap never reaches Postgres, let alone Google.
   */
  ai: { limit: 6, windowMs: 60_000 },
  /**
   * Sign-in attempts against one address.
   *
   * Keyed by the address rather than the caller, because the attack this is
   * for — working a password list against one known account — arrives from
   * many hosts and a per-IP limit never sees it accumulate. Ten in five
   * minutes is far more than someone mistyping their own password will ever
   * need, and slow enough that a list of any length is not worth starting.
   */
  signIn: { limit: 10, windowMs: 300_000 },
} as const satisfies Record<string, RateLimit>;

/**
 * Consumes one token. Returns false when the caller should be refused.
 *
 * Refills continuously rather than in fixed windows, so a burst at a window
 * boundary cannot spend two windows' allowance at once.
 */
export function consume(key: string, limit: RateLimit): boolean {
  const now = Date.now();

  if (buckets.size > MAX_KEYS) {
    // Cheapest correct thing: drop everything and let buckets refill. Evicting
    // by age would need an ordered structure for a map that should never get
    // this large in the first place.
    buckets.clear();
  }

  const bucket = buckets.get(key);

  if (!bucket) {
    buckets.set(key, { tokens: limit.limit - 1, updatedAt: now });
    return true;
  }

  const refill = ((now - bucket.updatedAt) / limit.windowMs) * limit.limit;
  const tokens = Math.min(limit.limit, bucket.tokens + refill);

  if (tokens < 1) {
    // updatedAt is not advanced on refusal, so a caller cannot reset their own
    // window by hammering it.
    bucket.tokens = tokens;
    return false;
  }

  bucket.tokens = tokens - 1;
  bucket.updatedAt = now;
  return true;
}

/** Clears all buckets. Tests only. */
export function resetRateLimits(): void {
  buckets.clear();
}
