"use client";

import { useToday } from "@/components/jobs/today-provider";
import { daysUntilFrom, formatDate } from "@/lib/format/deadline";

export function UpdateCardMeta({ publishedAt }: { publishedAt: string | null }) {
  const today = useToday();

  // SSR / prerender fallback: stable string to prevent hydration mismatches
  if (today === null) {
    const formatted = formatDate(publishedAt);
    return (
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center rounded-full border border-critical/20 bg-critical-soft px-2 py-0.5 text-[11px] font-semibold text-critical leading-tight">
          New
        </span>
        <span className="text-xs text-ink-3">
          {formatted ? `Posted ${formatted}` : "Posted today"}
        </span>
      </div>
    );
  }

  const pubDate = publishedAt ? publishedAt.slice(0, 10) : null;
  const daysAgo = pubDate ? daysUntilFrom(pubDate, today) : null;

  // Mark as New if posted within the last 7 days or today
  const isNew = daysAgo === null || daysAgo <= 7;

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
    <div className="flex items-center gap-2">
      {isNew ? (
        <span className="inline-flex items-center rounded-full border border-critical/20 bg-critical-soft px-2 py-0.5 text-[11px] font-semibold text-critical leading-tight">
          New
        </span>
      ) : null}
      <span className="text-xs text-ink-3">{text}</span>
    </div>
  );
}
