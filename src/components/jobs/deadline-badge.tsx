"use client";

import { ClockIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { describeDeadlineFrom, formatDate } from "@/lib/format/deadline";
import { useToday } from "./today-provider";

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
 * Today's date arrives from `TodayProvider` rather than being derived here, so
 * a list of twenty jobs runs one clock instead of twenty. See that file.
 */
export function DeadlineBadge({ date }: { date: string | null }) {
  const today = useToday();

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

  const deadline = describeDeadlineFrom(today, date);

  // The last day of a window is the one state that fills solid. Everything
  // else is a tint, and an open deadline gets no colour at all — see the
  // deadline ramp note in globals.css.
  const tone = deadline.urgency === "today" ? "criticalSolid" : deadline.tone;

  return (
    <Badge tone={tone} className="tabular shrink-0">
      <ClockIcon className="size-3" />
      {deadline.label}
    </Badge>
  );
}
