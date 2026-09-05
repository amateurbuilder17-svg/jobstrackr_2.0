import type { Identity } from "@/components/session/session-provider";

/**
 * The last answer `/api/session` gave, kept so the next load can paint before
 * asking again.
 *
 * ## What this is for, and what it is not
 *
 * It is not a way to make fewer database reads. `/api/session` is still asked
 * on every load, and the reads behind it — a shortlist, a tracked list, a name
 * — are three small queries against one user's own rows, on a plan with room to
 * spare (`scripts/check-traffic-budget.mjs`). Nothing here is a cost measure.
 *
 * It is a way to stop the shell being wrong for the length of a round trip.
 * `SessionProvider` starts with `ready: false`, and until the answer lands every
 * save and track button on the page renders inert and every avatar is a grey
 * circle. On a slow connection that is a second or more of a page that looks
 * signed out to someone who is not — and if the network is gone entirely, it is
 * the full eight-second deadline in `guardedFetch`. Seeding from here turns
 * both into one frame.
 *
 * ## Why it is keyed by user id
 *
 * A localStorage entry outlives the session and belongs to the browser profile,
 * not the person. So the same reasoning `public/sw.js` applies to its navigation
 * allowlist applies here, and harder: this is user data by definition. If the
 * entry could be read back without proving whose it was, a shared phone would
 * paint one person's name and shortlist for the next person to sign in on it.
 *
 * The proof is `readAuthCookieUser` — the id inside the session cookie the
 * browser is holding *right now*. An entry is returned only to a caller holding
 * the cookie of the account that wrote it. A different account misses. A guest
 * misses. An unreadable cookie misses. Every miss costs a round trip and
 * nothing else, which is the direction this decision has to fail in.
 *
 * Signing out clears the entry outright; see `SessionProvider`.
 */

const KEY = "jt.session.v1";

/**
 * How long an entry may be seeded from.
 *
 * Not a correctness bound — the fetch that follows corrects any staleness within
 * the same second, however old the entry is. It is a bound on how long one
 * person's name and shortlist may sit in a browser profile they have stopped
 * using. A week is long enough that a regular visitor effectively always hits,
 * and short enough that an abandoned browser forgets.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedSession {
  /** The account this belongs to. Compared before anything here is used. */
  uid: string;
  ids: string[];
  trackedJobIds: string[];
  identity: Identity;
  /** Milliseconds since epoch, for the age check only. */
  at: number;
}

/**
 * The stored session, if it belongs to `uid` and is not too old.
 *
 * Every read is defensive, for the reasons `@/lib/saved/storage` sets out:
 * `localStorage` is absent during server rendering, throws in Safari's private
 * mode, and holds whatever the user last pasted into devtools. A malformed
 * entry is a miss, never a crash and never a partially applied session.
 */
export function readSessionCache(uid: string, now = Date.now()): CachedSession | null {
  if (typeof localStorage === "undefined") return null;

  let parsed: unknown;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isCachedSession(parsed)) return null;
  if (parsed.uid !== uid) return null;
  if (now - parsed.at > MAX_AGE_MS) return null;
  // A clock that has moved backwards — a device correcting its time, a restored
  // backup — should not be able to hold an entry alive past its age check.
  if (parsed.at > now) return null;

  return parsed;
}

/** Records the server's answer. Overwrites, so the newest answer is the only one. */
export function writeSessionCache(entry: Omit<CachedSession, "at">, now = Date.now()): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...entry, at: now } satisfies CachedSession));
  } catch {
    // Quota exceeded, or storage disabled. The session in memory is still
    // correct; only the head start on the next load is lost.
  }
}

/**
 * Forgets the stored session.
 *
 * Called when the server says nobody is signed in, which covers signing out —
 * the case where leaving the entry behind is not merely stale but wrong.
 */
export function clearSessionCache(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* see writeSessionCache */
  }
}

/**
 * A full structural check, not a cast.
 *
 * The entry is about to be shown to someone as their own account, so "it parsed
 * as JSON" is not enough: a half-written or hand-edited entry that passed a cast
 * would paint an undefined name or an array of nulls into the shell.
 */
function isCachedSession(value: unknown): value is CachedSession {
  if (typeof value !== "object" || value === null) return false;

  const entry = value as Record<string, unknown>;
  if (typeof entry.uid !== "string" || entry.uid.length === 0) return false;
  if (typeof entry.at !== "number" || !Number.isFinite(entry.at)) return false;
  if (!isStringArray(entry.ids)) return false;
  if (!isStringArray(entry.trackedJobIds)) return false;

  const identity = entry.identity;
  if (typeof identity !== "object" || identity === null) return false;

  const who = identity as Record<string, unknown>;
  return (
    isNullableString(who.name) &&
    isNullableString(who.email) &&
    isNullableString(who.initials) &&
    typeof who.isAdmin === "boolean" &&
    typeof who.hasPassword === "boolean"
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
