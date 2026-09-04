"use client";

import { useToday } from "@/components/jobs/today-provider";
import { daysUntilFrom, formatDate } from "@/lib/format/deadline";
import { cn } from "@/lib/cn";

export function JobCardMeta({
  publishedAt,
  isFeatured,
  className,
}: {
  publishedAt: string | null;
  isFeatured?: boolean | null;
  className?: string;
}) {
  const today = useToday();

  // SSR / prerender fallback: stable string to prevent hydration mismatches
  if (today === null) {
    const formatted = formatDate(publishedAt);
    return (
      <div className={cn("flex items-center gap-1.5 text-[11px] text-ink-3", className)}>
        <span className="inline-flex items-center rounded-full border border-critical/20 bg-critical-soft px-1.5 py-0.2 text-[10px] font-semibold text-critical leading-tight">
          New
        </span>
        <span>{formatted ? `Posted ${formatted}` : "Posted today"}</span>
      </div>
    );
  }

  const pubDate = publishedAt ? publishedAt.slice(0, 10) : null;
  const daysAgo = pubDate ? daysUntilFrom(pubDate, today) : null;

  // Mark as New if featured, or posted within the last 7 days, or newly synced
  const isNew = Boolean(isFeatured) || daysAgo === null || daysAgo <= 7;

  let text = "Posted today";
  if (daysAgo === null || daysAgo <= 0) {
    text = "Posted today";
  } else if (daysAgo === 1) {
    text = "Posted yesterday";
  } else if (daysAgo > 1 && daysAgo <= 7) {
    text = `Posted ${String(daysAgo)} days ago`;
  } else if (publishedAt) {
    const formatted = formatDate(publishedAt);
    text = formatted ? `Posted ${formatted}` : "Posted recently";
  }

  return (
    <div className={cn("flex items-center gap-1.5 text-[11px] text-ink-3", className)}>
      {isNew ? (
        <span className="inline-flex items-center rounded-full border border-critical/20 bg-critical-soft px-1.5 py-0.2 text-[10px] font-semibold text-critical leading-tight">
          New
        </span>
      ) : null}
      <span>{text}</span>
    </div>
  );
}
