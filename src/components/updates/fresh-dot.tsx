"use client";

import { useToday } from "@/components/jobs/today-provider";

/**
 * "Published today."
 *
 * The old page answered this with a whole second section — "New in 24h" — above
 * the feed, which split every result set in two and, while searching, showed
 * matching rows twice. This is the same fact rendered where the fact belongs,
 * and it costs no query at all: the date is already on the card and today's
 * date is already in context for the deadline badges.
 *
 * Client-side because a page prerendered on Tuesday cannot know it is being
 * read on Wednesday — the same reason `DeadlineBadge` is a client component.
 * It renders nothing during the prerender, which is correct: "new" is not a
 * property of the document, and a crawler should not index it.
 */
export function FreshDot({ date }: { date: string | null }) {
  const today = useToday();
  if (today === null || date === null) return null;
  if (date.slice(0, 10) !== today) return null;

  return (
    <span className="inline-flex items-center gap-1 text-2xs font-semibold text-accent">
      <span className="size-1.5 rounded-full bg-accent" aria-hidden />
      New
    </span>
  );
}
