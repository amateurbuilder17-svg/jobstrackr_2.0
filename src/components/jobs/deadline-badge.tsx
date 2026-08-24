"use client";

import { useSyncExternalStore } from "react";

import { ClockIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { describeDeadline, formatDate, todayInIndia } from "@/lib/format/deadline";

/**
 * "5 days left", computed in the browser.
 *
 * It has to be. These pages are prerendered once and served from the CDN for
 * days, so a countdown calculated at build time would be frozen at whatever
 * "today" was when the build ran — a job would sit at "5 days left" a fortnight
 * after closing. Next refuses `new Date()` during a prerender for exactly this
 * reason, which is the framework catching a real bug rather than being fussy.
 *
 * So the server renders the absolute closing date, which is true forever and is
 * also what a crawler should index. The client then upgrades it to the relative
 * countdown, which is what a person actually wants to read.
 *
 * `useSyncExternalStore` rather than an effect: today's date is external state,
 * and the server snapshot of `null` is what lets the same component render the
 * static form during prerender without a hydration mismatch.
 */

/** Re-read at the next IST midnight, so an open tab does not go stale. */
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

export function DeadlineBadge({ date }: { date: string | null }) {
  const today = useSyncExternalStore<string | null>(subscribe, getSnapshot, getServerSnapshot);

  // Prerender and first paint: the absolute date, which never goes stale.
  if (today === null) {
    const absolute = formatDate(date);
    return (
      <Badge className="tabular shrink-0">
        <ClockIcon className="size-3" />
        {absolute ? `Closes ${absolute}` : "Date not announced"}
      </Badge>
    );
  }

  const deadline = describeDeadline(date);
  return (
    <Badge tone={deadline.tone} className="tabular shrink-0">
      <ClockIcon className="size-3" />
      {deadline.label}
    </Badge>
  );
}
