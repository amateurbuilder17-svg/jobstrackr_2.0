"use client";

import { createContext, use, useSyncExternalStore, type ReactNode } from "react";

/**
 * The current instant, ticking once per second, shared by every countdown on
 * the page.
 *
 * One subscription and one interval for the whole wall, for exactly the reason
 * `TodayProvider` hoists the midnight timer: a page of twenty countdowns each
 * owning its own `setInterval` is twenty timers waking the main thread every
 * second and twenty independent re-renders, on hardware where that is
 * measurable. Here the interval fires once and React re-renders the subtree.
 *
 * `null` on the server, and the cards render their absolute date in that state.
 * That is correct rather than merely safe: the absolute date is true forever,
 * it is what a crawler should index, and it means the prerendered HTML does not
 * contain a countdown that was already stale when it was written to the CDN.
 */

const NowContext = createContext<number | null>(null);

/**
 * A single interval, at one second.
 *
 * Deliberately not adaptive per card — the interval belongs to the page, and
 * the *cards* decide how much of the number to show (`tickInterval` in
 * `lib/countdown/remaining.ts` governs their precision, not their repaint).
 * Making this adaptive would mean the page's slowest card sets the rate for
 * the most urgent one.
 *
 * Paused while the tab is hidden. A backgrounded tab counting down is doing
 * work nobody can see, and browsers throttle it unevenly anyway; re-reading the
 * clock on `visibilitychange` snaps it back to the truth on return, which is
 * more correct than the ticks it missed.
 */
function subscribe(onChange: () => void): () => void {
  let timer: ReturnType<typeof setInterval> | undefined;

  const start = () => {
    timer ??= setInterval(onChange, 1000);
  };
  const stop = () => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  const onVisibility = () => {
    if (document.hidden) {
      stop();
    } else {
      onChange();
      start();
    }
  };

  if (!document.hidden) start();
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

/**
 * Rounded to the second.
 *
 * `useSyncExternalStore` bails out of re-rendering when the snapshot is
 * unchanged by `Object.is`, and `Date.now()` returns a new millisecond every
 * time it is called — so an unrounded snapshot re-renders on every store read,
 * not on every tick.
 */
const getSnapshot = (): number => Math.floor(Date.now() / 1000) * 1000;
const getServerSnapshot = (): null => null;

export function NowProvider({ children }: { children: ReactNode }) {
  const now = useSyncExternalStore<number | null>(subscribe, getSnapshot, getServerSnapshot);
  return <NowContext value={now}>{children}</NowContext>;
}

/** The shared instant, or null during server render and before hydration. */
export function useNow(): number | null {
  return use(NowContext);
}
