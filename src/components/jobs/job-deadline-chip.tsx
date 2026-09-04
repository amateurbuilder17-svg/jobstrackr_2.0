"use client";

import { ClockIcon } from "@/components/icons";
import { daysUntilFrom, formatDate } from "@/lib/format/deadline";
import { cn } from "@/lib/cn";
import { useToday } from "./today-provider";

export function JobDeadlineChip({
  date,
  className,
}: {
  date: string | null;
  className?: string;
}) {
  const today = useToday();

  // SSR / prerender fallback to prevent hydration mismatch
  if (today === null) {
    const formatted = formatDate(date);
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-2 tabular",
          className,
        )}
      >
        <ClockIcon className="size-3 shrink-0" aria-hidden="true" />
        {formatted ? `Last date: ${formatted}` : "Date not announced"}
      </span>
    );
  }

  const daysLeft = daysUntilFrom(today, date);

  let label: string;
  let toneClass: string;

  const formatted = formatDate(date);

  if (daysLeft === null) {
    label = "Date not announced";
    toneClass = "border-line bg-surface-2 text-ink-2";
  } else if (daysLeft < 0) {
    label = formatted ? `Last date: ${formatted}` : "Closed";
    toneClass = "border-critical/20 bg-critical-soft text-critical";
  } else if (daysLeft === 0) {
    label = formatted ? `Last date: ${formatted}` : "Last day";
    toneClass = "border-critical/20 bg-critical-soft text-critical";
  } else if (daysLeft <= 3) {
    label = `${String(daysLeft)} day${daysLeft === 1 ? "" : "s"} left`;
    toneClass = "border-critical/20 bg-critical-soft text-critical";
  } else if (daysLeft <= 14) {
    label = `${String(daysLeft)} days left`;
    toneClass = "border-warn/25 bg-warn-soft text-warn";
  } else {
    label = formatted ? `Last date: ${formatted}` : "Date not announced";
    toneClass = "border-line bg-surface-2 text-ink-2";
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tabular leading-normal",
        toneClass,
        className,
      )}
    >
      <ClockIcon className="size-3 shrink-0" aria-hidden="true" />
      {label}
    </span>
  );
}
