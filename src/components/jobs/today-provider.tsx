"use client";

import { createContext, use, useSyncExternalStore, type ReactNode } from "react";

import { todayInIndia } from "@/lib/format/deadline";

/**
 * Today's date in India, computed once per page.
 *
 * Every deadline in the app is relative to this one fact, and it used to be
 * derived independently inside each `DeadlineBadge`: a list of twenty jobs
 * mounted twenty `useSyncExternalStore` subscriptions, twenty timers counting
 * down to the same IST midnight, and twenty `Intl.DateTimeFormat` instances
 * built to answer the same question. On a mid-range Android that is measurable,
 * and it scales with the length of the list — which is the direction this
 * redesign is pushing lists in.
 *
 * So the subscription is hoisted here and the badges become pure functions of a
 * prop. One timer, one formatter, one re-render at midnight.
 *
 * The value is deliberately `string | null`. `null` is what the server renders,
 * and it is also what a badge outside this provider sees — in both cases the
 * badge falls back to the absolute closing date, which is correct rather than
 * merely safe: it is true forever and it is what a crawler should index.
 */

const TodayContext = createContext<string | null>(null);

/**
 * Re-read at the next IST midnight, so a tab left open overnight does not sit
 * on a stale countdown.
 */
function subscribe(onChange: () => void): () => void {
  let timer: ReturnType<typeof setTimeout>;

  const scheduleNextMidnight = () => {
    const nowIst = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const nextMidnight = new Date(nowIst);
    nextMidnight.setHours(24, 0, 30, 0); // 30s past, to clear any rounding
    const delay = Math.max(nextMidnight.getTime() - nowIst.getTime(), 60_000);

    timer = setTimeout(() => {
      onChange();
      scheduleNextMidnight();
    }, delay);
  };

  scheduleNextMidnight();
  return () => {
    clearTimeout(timer);
  };
}

const getSnapshot = (): string => todayInIndia();
const getServerSnapshot = (): null => null;

export function TodayProvider({ children }: { children: ReactNode }) {
  const today = useSyncExternalStore<string | null>(subscribe, getSnapshot, getServerSnapshot);
  return <TodayContext value={today}>{children}</TodayContext>;
}

/** Today in India as `YYYY-MM-DD`, or `null` during server render. */
export function useToday(): string | null {
  return use(TodayContext);
}
