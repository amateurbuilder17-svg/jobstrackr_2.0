"use client";

import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { mergeGuestSavesAction, setJobSavedAction } from "@/lib/saved/actions";
import { trackJobAction, untrackJobAction } from "@/lib/tracker/actions";
import {
  clearGuestSaves,
  enqueue,
  readGuestSaves,
  readQueue,
  resolvePending,
  writeGuestSaves,
} from "@/lib/saved/storage";

/**
 * One source of truth for "who is this, and what have they done with these
 * jobs" — shared by every save button on the page and by the shell above them.
 *
 * Per-user state is fetched here, once, after hydration — not rendered into the
 * HTML. That is what lets /jobs and all 2,700 job pages stay static: the cached
 * document paints, then the buttons and the avatar fill in.
 *
 * This provider sits above `TopBar` in the shell, which is why it is a session
 * provider rather than a saved-jobs one. The alternative — a second provider
 * with a second fetch, so the top bar could learn a name the first request was
 * already authenticated to read — would double the dynamic requests a session
 * makes, which is the exact cost this whole pattern exists to avoid.
 *
 * Three states have to coexist, and keeping them straight is most of this file:
 *
 *   - **guest**: localStorage is authoritative; there is no server copy.
 *   - **signed in, online**: the server is authoritative; local state is a
 *     mirror kept optimistically ahead of it.
 *   - **signed in, offline**: the mirror is ahead and the difference is queued,
 *     to be replayed when the network returns.
 */

/** Who the shell is drawing. Null for a guest, and null until `ready`. */
export interface Identity {
  name: string | null;
  email: string | null;
  /** Null when there is no name and no address to derive one from. */
  initials: string | null;
  isAdmin: boolean;
}

interface SessionContextValue {
  /** True once hydrated. Buttons render inert until then rather than guessing. */
  ready: boolean;
  signedIn: boolean;
  /**
   * Null for a guest, and null before `ready` — the shell must draw a
   * same-sized placeholder in that window rather than guess at a name, or the
   * top bar reflows the moment the session resolves.
   */
  identity: Identity | null;
  isSaved: (jobId: string) => boolean;
  /**
   * The saved ids. Exposed because the guest saved list has to exchange them
   * for job cards, and reading localStorage a second time there would mean two
   * sources of truth that drift the moment something is toggled.
   */
  savedIds: readonly string[];
  toggle: (jobId: string) => void;
  /** Jobs whose intent has not reached the server yet. */
  pending: ReadonlySet<string>;

  /**
   * Tracking rides along here rather than in a provider of its own.
   *
   * It is the same question asked of the same session — "what has this person
   * already done with this job?" — and `/api/session` answers both in one
   * response. A second provider would mean a second request per session to
   * light up a button sitting two pixels from the first one.
   *
   * Tracking has no offline queue, deliberately. Saving is a reflex people
   * perform while scrolling, sometimes on a train; tracking is a considered
   * act on a detail page, and a failure that silently succeeds later is worse
   * there than one that rolls back and says so.
   */
  isTracked: (jobId: string) => boolean;
  toggleTracked: (jobId: string) => void;
  trackingPending: ReadonlySet<string>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [trackedIds, setTrackedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [trackingPending, setTrackingPending] = useState<ReadonlySet<string>>(() => new Set());
  const [signedIn, setSignedIn] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [ready, setReady] = useState(false);

  // Read inside callbacks without making them depend on it, so a re-render does
  // not detach the `online` listener and lose the flush.
  const signedInRef = useRef(false);

  /* ── Send one queued intent, and clear it if the server agrees ────────── */
  const push = useCallback(async (jobId: string, saved: boolean) => {
    const result = await setJobSavedAction(jobId, saved);

    if (result.ok) {
      resolvePending(jobId);
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
      return;
    }

    if (result.reason === "invalid") {
      // The server will never accept this, so replaying it forever is worse
      // than dropping it. Roll the optimistic state back to the truth.
      resolvePending(jobId);
      setIds((prev) => {
        const next = new Set(prev);
        if (result.saved) next.add(jobId);
        else next.delete(jobId);
        return next;
      });
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(jobId);
        return next;
      });
    }
    // Anything else — offline, a 500, a dropped connection — stays queued. The
    // optimistic state is kept deliberately: the user's intent has not failed,
    // it has not been delivered yet.
  }, []);

  /* ── Drain the queue ──────────────────────────────────────────────────── */
  const flush = useCallback(async () => {
    if (!signedInRef.current) return;
    const queued = readQueue();
    // Sequential rather than parallel: these are per-row writes to one user's
    // rows, and a burst on reconnect is a thundering herd for no benefit.
    for (const item of queued) {
      await push(item.jobId, item.saved);
    }
  }, [push]);

  /* ── Hydrate ──────────────────────────────────────────────────────────── */
  const hydrate = useCallback(() => {
    // An AbortController rather than a `let cancelled = false` flag: the flag
    // is narrowed to the literal `false` by the compiler, so every guard below
    // it reads as dead code. `signal.aborted` is a genuine boolean, and it
    // doubles as the cancellation signal for the fetch.
    const controller = new AbortController();
    const { signal } = controller;

    // Read through a call, not directly. After one `if (signal.aborted) return`
    // the compiler narrows the property to `false` for the rest of the function
    // and flags every later guard as dead — but it can flip during any of the
    // awaits below, so the guards are real. A call returns an unnarrowed
    // boolean each time it is evaluated.
    const aborted = () => signal.aborted;

    void (async () => {
      const guestSaves = readGuestSaves();

      let serverIds: string[] = [];
      let tracked: string[] = [];
      let authed = false;
      let who: Identity | null = null;

      try {
        const response = await fetch("/api/session", { cache: "no-store", signal });
        if (response.ok) {
          const data = (await response.json()) as {
            signedIn: boolean;
            ids: string[];
            trackedJobIds: string[];
            identity: Identity | null;
          };
          authed = data.signedIn;
          serverIds = data.ids;
          tracked = data.trackedJobIds;
          who = data.identity;
        }
      } catch {
        // Offline on first load. Fall through with whatever is local; a guest
        // still sees their shortlist, and a signed-in user sees an empty one
        // that fills in when the network returns.
      }

      if (aborted()) return;

      signedInRef.current = authed;
      setSignedIn(authed);
      setIdentity(who);

      if (authed) {
        // First sign-in with a guest shortlist: fold it in, then let go of the
        // local copy so the server is unambiguously authoritative afterwards.
        if (guestSaves.length > 0) {
          const merged = await mergeGuestSavesAction(guestSaves);
          if (merged.ok) {
            clearGuestSaves();
            serverIds = [...new Set([...serverIds, ...guestSaves])];
          }
        }
        // Union, not replace. The button is live before this resolves, so a
        // press made in that window is already in state and must survive the
        // server's answer arriving.
        if (!aborted()) setIds((prev) => new Set([...prev, ...serverIds]));
        // Replace rather than union: unlike saves, there is no offline queue
        // holding intents the server has not seen, so the server is simply
        // right.
        if (!aborted()) setTrackedIds(new Set(tracked));

        const queued = readQueue();
        if (queued.length > 0) {
          setPending(new Set(queued.map((q) => q.jobId)));
          // Apply queued intents over the server's answer, so a save made
          // offline does not visibly disappear on the next load.
          setIds((prev) => {
            const next = new Set(prev);
            for (const item of queued) {
              if (item.saved) next.add(item.jobId);
              else next.delete(item.jobId);
            }
            return next;
          });
          void flush();
        }
      } else {
        setIds((prev) => new Set([...prev, ...guestSaves]));
      }

      if (!aborted()) setReady(true);
    })();

    return () => {
      controller.abort();
    };
  }, [flush]);

  useEffect(() => hydrate(), [hydrate]);

  /**
   * Re-hydrate when the signed-in state changes underneath us.
   *
   * This provider sits in the app shell, above the router outlet, so it does
   * *not* remount when someone signs in — that is a client-side navigation, and
   * the shell survives it. Without this, a guest who signs in kept a provider
   * still convinced they were a guest: their local shortlist was never merged,
   * and every save went on writing to localStorage instead of their account.
   *
   * The check is the auth cookie rather than another request. `@supabase/ssr`
   * writes it without `httpOnly` precisely so the browser can read it, which
   * makes this a string comparison per navigation instead of a fetch. Its
   * presence is only a hint that something changed — `/api/session` remains the
   * authority, and is what actually re-runs.
   */
  const pathname = usePathname();
  useEffect(() => {
    if (hasAuthCookie() !== signedInRef.current) hydrate();
  }, [pathname, hydrate]);

  /* ── Replay when the network comes back ───────────────────────────────── */
  useEffect(() => {
    const onOnline = () => {
      void flush();
    };
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("online", onOnline);
    };
  }, [flush]);

  /* ── Toggle ───────────────────────────────────────────────────────────── */
  const toggle = useCallback(
    (jobId: string) => {
      // Computed from the current set inside the updater so rapid double taps
      // cannot both read the same stale value and cancel each other out.
      setIds((prev) => {
        const willSave = !prev.has(jobId);
        const next = new Set(prev);
        if (willSave) next.add(jobId);
        else next.delete(jobId);

        if (signedInRef.current) {
          // Queued *before* the request goes out. If the tab closes mid-flight
          // the intent survives; if it were recorded after a failure, a hard
          // navigation during the request would lose it silently.
          enqueue(jobId, willSave);
          setPending((p) => new Set(p).add(jobId));
          void push(jobId, willSave);
        } else {
          writeGuestSaves(next);
        }

        return next;
      });
    },
    [push],
  );

  /* ── Track ────────────────────────────────────────────────────────────── */
  const toggleTracked = useCallback((jobId: string) => {
    setTrackedIds((prev) => {
      const willTrack = !prev.has(jobId);
      const next = new Set(prev);
      if (willTrack) next.add(jobId);
      else next.delete(jobId);

      setTrackingPending((p) => new Set(p).add(jobId));

      void (async () => {
        const result = willTrack ? await trackJobAction(jobId) : await untrackJobAction(jobId);

        setTrackingPending((p) => {
          const cleared = new Set(p);
          cleared.delete(jobId);
          return cleared;
        });

        // Reconciled against the server's answer rather than assumed. A guest
        // pressing Track gets `unauthenticated` back, and the button must
        // return to its unpressed state rather than lying about a row that was
        // never written.
        if (!result.ok) {
          setTrackedIds((current) => {
            const rolledBack = new Set(current);
            if (willTrack) rolledBack.delete(jobId);
            else rolledBack.add(jobId);
            return rolledBack;
          });
        }
      })();

      return next;
    });
  }, []);

  const isTracked = useCallback((jobId: string) => trackedIds.has(jobId), [trackedIds]);

  const isSaved = useCallback((jobId: string) => ids.has(jobId), [ids]);
  const savedIds = useMemo(() => [...ids], [ids]);

  return (
    <SessionContext.Provider
      value={{
        ready,
        signedIn,
        identity,
        isSaved,
        savedIds,
        toggle,
        pending,
        isTracked,
        toggleTracked,
        trackingPending,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

/** Whether a Supabase auth cookie is present. A hint, never the authority. */
function hasAuthCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").some((c) => c.startsWith("sb-"));
}

function useSessionContext(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("This hook must be used inside <SessionProvider>.");
  return context;
}

/**
 * Who is signed in. The shell's view of the store.
 *
 * `ready` is what separates "nobody is signed in" from "we have not asked yet",
 * and the top bar has to tell them apart: the second is a placeholder, the
 * first is a sign-in link.
 */
export function useSession(): Pick<SessionContextValue, "ready" | "signedIn" | "identity"> {
  return useSessionContext();
}

/** The saved-jobs view of the same store, named for what the caller wants. */
export function useSaved(): SessionContextValue {
  return useSessionContext();
}

/** The tracking half of the same store, named for what the caller wants. */
export function useTracked(): Pick<
  SessionContextValue,
  "ready" | "signedIn" | "isTracked" | "toggleTracked" | "trackingPending"
> {
  return useSaved();
}
