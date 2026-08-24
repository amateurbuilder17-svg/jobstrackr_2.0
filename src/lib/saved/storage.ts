/**
 * Local persistence for saved jobs.
 *
 * Two separate things live here, and conflating them is the bug this file
 * exists to avoid:
 *
 *   1. **Guest saves** — the shortlist of someone with no account. This is the
 *      authoritative copy until they sign in, at which point it is merged and
 *      cleared.
 *
 *   2. **The pending queue** — intents from a signed-in user whose mutation did
 *      not reach the server. This is a replay log, not a shortlist: it holds
 *      "make this job saved/unsaved", and is drained on reconnect.
 *
 * Pure functions over `localStorage`, deliberately free of React, so the
 * reconciliation rules can be tested without rendering anything.
 */

const GUEST_KEY = "jt.saved.guest.v1";
const QUEUE_KEY = "jt.saved.queue.v1";

/** One unsent intent. `saved` is the desired end state, not a delta. */
export interface PendingSave {
  jobId: string;
  saved: boolean;
  /** Milliseconds since epoch, used only to break ties on replay. */
  at: number;
}

/**
 * Every read is defensive. `localStorage` is absent during server rendering,
 * throws in Safari private mode, and contains whatever the user last pasted
 * into devtools. None of those should take the page down with them.
 */
function read<T>(key: string, fallback: T): T {
  if (typeof localStorage === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded, or storage disabled. The in-memory state is still
    // correct for this session; only persistence is lost, and a save that
    // survives the current page is better than an exception that does not.
  }
}

/* ── Guest shortlist ───────────────────────────────────────────────────── */

export function readGuestSaves(): string[] {
  return read<string[]>(GUEST_KEY, []).filter((id) => typeof id === "string");
}

export function writeGuestSaves(ids: Iterable<string>): void {
  write(GUEST_KEY, [...new Set(ids)]);
}

export function clearGuestSaves(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(GUEST_KEY);
  } catch {
    /* see write() */
  }
}

/* ── Pending queue ─────────────────────────────────────────────────────── */

export function readQueue(): PendingSave[] {
  return read<PendingSave[]>(QUEUE_KEY, []).filter(
    (item): item is PendingSave =>
      typeof item.jobId === "string" && typeof item.saved === "boolean",
  );
}

/**
 * Records an intent, replacing any earlier one for the same job.
 *
 * Last intent wins, and that is the whole reconciliation rule. Saving then
 * unsaving while offline must arrive at the server as a single unsave — a
 * queue that replayed both in order would work, but one that replayed them
 * out of order would leave the row saved, which is the state the user
 * explicitly rejected.
 */
export function enqueue(jobId: string, saved: boolean, now = Date.now()): PendingSave[] {
  const next = readQueue().filter((item) => item.jobId !== jobId);
  next.push({ jobId, saved, at: now });
  write(QUEUE_KEY, next);
  return next;
}

/** Drops one job's intent, after the server has accepted it. */
export function resolvePending(jobId: string): PendingSave[] {
  const next = readQueue().filter((item) => item.jobId !== jobId);
  write(QUEUE_KEY, next);
  return next;
}

export function clearQueue(): void {
  write(QUEUE_KEY, []);
}
