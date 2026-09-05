"use client";

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

import { guardedFetch } from "@/lib/net/guarded-fetch";
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
import { authCookieNames, readAuthCookieUser } from "@/lib/session/auth-cookie";
import { clearSessionCache, readSessionCache, writeSessionCache } from "@/lib/session/cache";

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
 *
 * Across all three, the first paint no longer waits for the network. The last
 * answer the server gave is kept in `@/lib/session/cache`, keyed to the account
 * in the session cookie, and seeded here on mount — so the buttons and the
 * avatar are live in a frame rather than in a round trip. It is a head start,
 * not a source of truth: `/api/session` is still asked on every load, and every
 * seeded value is reconciled against what it says.
 */

/** Who the shell is drawing. Null for a guest, and null until `ready`. */
export interface Identity {
  name: string | null;
  email: string | null;
  /** Null when there is no name and no address to derive one from. */
  initials: string | null;
  isAdmin: boolean;
  /**
   * Whether this account can be signed into with a password — false for a
   * Google account that has never set one. Decides whether the menu offers to
   * set a password or to reset one. Derived server-side by `userHasPassword`.
   */
  hasPassword: boolean;
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
  /**
   * Re-read the session if the auth cookie no longer matches what we believe.
   * Called by `SessionRouteWatcher` on navigation; cheap and idempotent.
   */
  recheck: () => void;
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

  /**
   * The auth cookies as they were when we last asked `/api/session` about
   * them. `recheck` compares against this rather than against `signedIn`, and
   * that difference is the whole guardrail — see it for why.
   */
  const askedAboutRef = useRef<string | null>(null);

  /**
   * Whether this provider has already painted from the session cache.
   *
   * The seed happens once, on mount, and never on a `recheck`. A recheck fires
   * because the cookies changed — a sign-in or a sign-out — and painting the
   * previous session over the new one is the exact failure the cache is keyed
   * by user id to avoid. It also keeps a later hydrate from stamping on
   * optimistic toggles made since mount.
   */
  const seededRef = useRef(false);

  /**
   * The saved ids the seed painted, kept so the server's answer can take them
   * back. Null when nothing was seeded. See the union below for why the two
   * cannot be told apart by looking at the state itself.
   */
  const seedIdsRef = useRef<readonly string[] | null>(null);

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

    // Recorded before the request, not after it. If this were written on
    // success, a failed hydrate would leave the old value in place and the
    // next navigation would ask again — which is the loop this is here to
    // prevent, rebuilt.
    askedAboutRef.current = authCookieNames();

    // Read through a call, not directly. After one `if (signal.aborted) return`
    // the compiler narrows the property to `false` for the rest of the function
    // and flags every later guard as dead — but it can flip during any of the
    // awaits below, so the guards are real. A call returns an unnarrowed
    // boolean each time it is evaluated.
    const aborted = () => signal.aborted;

    /* ── Paint the last known answer, then go and verify it ───────────────
     *
     * `ready` is false until the fetch below lands, and everything the shell
     * draws from the session is inert until it does: every save and track
     * button, and the avatar. That is a round trip of a page looking signed
     * out to someone who is not — and when the network is gone, it is the full
     * `timeoutMs` deadline. Seeding turns both into one frame.
     *
     * The cookie is what makes this safe to do. It carries the id of the
     * account the browser is holding a session for, and `readSessionCache`
     * returns nothing unless that id is the one that wrote the entry. A
     * different account on the same browser misses; so does a guest, and so
     * does a cookie in a format `readAuthCookieUser` cannot read.
     */
    const cookieUser = seededRef.current ? null : readAuthCookieUser();
    seededRef.current = true;
    // An expiry already past is not a session. Checked here rather than left to
    // the server so that the one case the seed must never produce — a signed-in
    // shell for someone whose session has ended — cannot happen at all.
    const cached =
      cookieUser && cookieUser.expiresAt * 1000 > Date.now()
        ? readSessionCache(cookieUser.id)
        : null;

    if (cached) {
      signedInRef.current = true;
      setSignedIn(true);
      setIdentity(cached.identity);
      setTrackedIds(new Set(cached.trackedJobIds));

      // Queued intents are applied over the seed for the same reason they are
      // applied over the server's answer below: a save made offline must not
      // look forgotten while the page waits for a network that is not coming
      // back.
      const queued = readQueue();
      seedIdsRef.current = cached.ids;
      setIds((prev) => {
        const next = new Set([...prev, ...cached.ids]);
        for (const item of queued) {
          if (item.saved) next.add(item.jobId);
          else next.delete(item.jobId);
        }
        return next;
      });
      if (queued.length > 0) setPending(new Set(queued.map((q) => q.jobId)));

      setReady(true);
    }

    void (async () => {
      const guestSaves = readGuestSaves();

      let serverIds: string[] = [];
      let tracked: string[] = [];
      let authed = false;
      let who: Identity | null = null;
      /**
       * Whether `/api/session` replied at all — which is not the same question
       * as whether it said yes. A failure leaves `authed` false, and acting on
       * that would be reading "we could not ask" as "you are signed out".
       */
      let answered = false;

      try {
        // Guarded, and this is the call that most needs it. `recheck` runs on
        // every client navigation, and while the server is down the cookie
        // check it guards on can never agree with what we know — so a person
        // browsing a cached, static site would fire one failed request per
        // page, indefinitely. The breaker turns that into one request per
        // cooldown, and the deadline is what stops a hung socket from leaving
        // `ready` false and every save button inert for the whole session.
        const response = await guardedFetch("/api/session", {
          cache: "no-store",
          signal,
          timeoutMs: 8_000,
          retries: 1,
        });
        if (response.ok) {
          answered = true;
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
        // Offline, hung, or an endpoint the breaker has given up on for now.
        // Fall through with whatever is local; a guest
        // still sees their shortlist, and a signed-in user sees an empty one
        // that fills in when the network returns.
      }

      if (aborted()) return;

      // Nothing came back — offline, hung, or an endpoint the breaker has given
      // up on for now. Whatever we already believe is the best answer available,
      // and keeping it matters beyond appearances: declaring a signed-in person
      // a guest here would send their next save into the guest shortlist
      // instead of into the replay queue, where it belongs.
      //
      // The test is `signedInRef`, not the `cached` from this run, and the
      // difference is load-bearing. `hydrate` runs more than once — twice on
      // mount under StrictMode, and again on every `recheck` — and only the
      // first of those seeds, because `seededRef` deliberately allows one. A
      // guard keyed on this run's seed therefore held on the pass that painted
      // the session and let go on the very next one, which erased it. What the
      // provider currently believes survives every pass, which is the actual
      // question: has anything told us otherwise?
      if (!answered && signedInRef.current) {
        setReady(true);
        return;
      }

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
        //
        // But a union alone stopped being enough once the seed could put ids
        // here. An id painted from the cache and absent from the server is a
        // save undone somewhere else — on a phone, in another tab — and a union
        // would keep showing it as saved for the rest of the session. So the
        // seeded ids, and only those, are taken back when the server does not
        // have them. A press made since mount is never one of them: it is in
        // the replay queue, which is applied over this a few lines below.
        const seededIds = seedIdsRef.current;
        if (!aborted())
          setIds((prev) => {
            const next = new Set([...prev, ...serverIds]);
            if (seededIds) {
              const live = new Set(serverIds);
              const unsent = new Set(readQueue().map((item) => item.jobId));
              for (const id of seededIds) {
                if (!live.has(id) && !unsent.has(id)) next.delete(id);
              }
            }
            return next;
          });
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

        // Recorded after the merge, so a guest shortlist folded in at sign-in is
        // part of what the next load paints. The id is read again rather than
        // reused from above: this request may have rotated the cookies, and an
        // entry keyed to a cookie that no longer exists could never be read
        // back. No id, no entry — the seed is an optimisation, and one that
        // cannot prove whose data it holds is not worth having.
        const uid = readAuthCookieUser()?.id;
        if (uid && who) {
          writeSessionCache({ uid, ids: serverIds, trackedJobIds: tracked, identity: who });
        }
      } else {
        // Only when the server actually answered. Signing out is the case this
        // is here for: an entry left behind then is not stale, it is one
        // person's name and shortlist waiting in the next person's browser. A
        // *failed* request must never take this branch, or an offline load
        // would throw away the entry that makes the next one instant.
        if (answered) clearSessionCache();
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
   * makes this a string comparison instead of a fetch. Its presence is only a
   * hint that something changed — `/api/session` remains the authority, and is
   * what actually re-runs.
   *
   * The *trigger* used to be `usePathname()` right here, and it had to move.
   * That hook reads URL data, this provider is in the root layout, and under
   * Cache Components a client hook reading the URL outside a `<Suspense>`
   * boundary blocks prerendering for the whole route. It was invisible for as
   * long as every dynamic route had `generateStaticParams`; the first one
   * without them — /syllabus/[slug] — failed the build on it. So the watching
   * lives in `SessionRouteWatcher`, which is one line of JSX inside a boundary,
   * and this exposes the recheck for it to call.
   */
  const recheck = useCallback(() => {
    // Compared against the cookies we last asked about, not against
    // `signedIn`. The old test — "is there a cookie, and does that agree with
    // what the server told us" — had a state it could never leave: a stale
    // cookie the server does not honour makes the two disagree permanently,
    // so every navigation re-asked, for the whole life of the tab. That is one
    // dynamic request per page view for a guest, on an app whose pages are
    // static precisely so guests cost nothing.
    //
    // It was not hypothetical. An abandoned Google sign-in leaves
    // `sb-<ref>-auth-token-code-verifier` behind indefinitely, and the old
    // check counted any `sb-` cookie as a session.
    //
    // Asking "have the cookies changed since we last asked?" cannot get stuck:
    // whatever the answer turns out to be, the same cookies are never asked
    // about twice. Signing in and signing out both change them, which is the
    // only thing this ever needed to notice.
    const cookies = authCookieNames();
    if (cookies !== askedAboutRef.current) hydrate();
  }, [hydrate]);

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
        recheck,
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

/** Just the recheck, for the route watcher. */
export function useSessionRecheck(): () => void {
  return useSessionContext().recheck;
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
