import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { CardInteractive } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { ExamUpdateCard as UpdateData } from "@/lib/db/queries/exam-updates";
import { formatDate } from "@/lib/format/deadline";
import { CATEGORY_LABELS, CATEGORY_TONE } from "@/lib/updates/categories";

/**
 * One update in a list.
 *
 * A Server Component with no interactive state, so a list of twenty costs no
 * JavaScript. The whole card is clickable through a stretched pseudo-element on
 * the title link rather than by wrapping everything in one anchor — wrapping
 * makes a screen reader announce the category, date and summary as the link
 * text, which is unusable.
 */
export function UpdateCard({ update }: { update: UpdateData }) {
  const category = update.category;
  const date = formatDate(update.published_date ?? update.published_at);

  return (
    <CardInteractive className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {update.organization ? (
            <p className="truncate text-2xs font-medium tracking-wide text-ink-3 uppercase">
              {update.organization.short_name ?? update.organization.name}
            </p>
          ) : null}
          <h3 className="mt-1 text-base leading-snug font-semibold text-ink">
            <Link href={`/updates/${update.slug}`} className="after:absolute after:inset-0">
              {update.title}
            </Link>
          </h3>
        </div>

        <Badge tone={CATEGORY_TONE[category]} className="shrink-0">
          {CATEGORY_LABELS[category]}
        </Badge>
      </div>

      {update.summary ? (
        <p className="mt-2 line-clamp-2 text-sm text-ink-2">{update.summary}</p>
      ) : null}

      {date ? <p className="mt-2 text-xs text-ink-3">{date}</p> : null}
    </CardInteractive>
  );
}

export function UpdateCardSkeleton() {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="mt-2 h-5 w-3/4" />
      <Skeleton className="mt-3 h-4 w-full" />
      <Skeleton className="mt-1.5 h-4 w-2/3" />
    </div>
  );
}
