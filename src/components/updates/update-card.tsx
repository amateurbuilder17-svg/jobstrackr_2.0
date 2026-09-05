import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { OrganizationLogo } from "@/components/home/organization-logo";
import { toInitials } from "@/components/home/monogram";
import type { ExamUpdateCard as UpdateData } from "@/lib/db/queries/exam-updates";
import { CATEGORY_CTA, CATEGORY_LABELS, CATEGORY_TONE } from "@/lib/updates/categories";
import { UpdateCardMeta } from "./update-card-meta";

/** Formats organization name + abbreviation (e.g. "Staff Selection Commission (SSC)") */
function formatOrgSubtitle(
  org?: { name?: string | null; short_name?: string | null } | null,
): string | null {
  if (!org) return null;
  const name = org.name?.trim();
  const short = org.short_name?.trim();

  if (name && short && name.toLowerCase() !== short.toLowerCase()) {
    if (!name.toLowerCase().includes(`(${short.toLowerCase()})`)) {
      return `${name} (${short})`;
    }
    return name;
  }
  return name ?? short ?? null;
}

/**
 * One update in a list matching the clean, card-based visual design of the jobs page.
 *
 * - Left: Logo plate with graceful monogram/initials fallback.
 * - Right:
 *   - Header row with [New] badge, relative posted time on left, and category badge on right.
 *   - Bold title linked via stretched pseudo-element.
 *   - Organization subtitle with acronym.
 *   - Summary preview text.
 *   - Bottom pill rail: Exam chip, actionable CTA chip, and tags.
 */
export function UpdateCard({
  update,
  variant = "card",
}: {
  update: UpdateData;
  variant?: "row" | "card";
}) {
  const category = update.category;
  const orgSubtitle = formatOrgSubtitle(update.organization);
  const initials = toInitials(
    update.organization?.short_name ??
      update.organization?.name ??
      update.exam?.short_name ??
      update.exam?.name ??
      "GOVT",
  );
  const examLabel = update.exam?.short_name ?? update.exam?.name ?? null;
  const ctaText = CATEGORY_CTA[category];

  const containerClass =
    variant === "card"
      ? "relative rounded-2xl border border-line/80 bg-surface p-4 sm:p-5 shadow-xs transition-all duration-200 hover:border-line-strong hover:shadow-sm focus-within:border-accent-line"
      : "relative border-b border-line bg-surface p-4 sm:px-5 sm:py-4 transition-colors duration-150 hover:bg-surface-2/70 focus-within:bg-surface-2/70";

  return (
    <article className={containerClass}>
      <div className="flex items-start gap-3.5 sm:gap-4">
        {/* Left Column: Organization Logo Slot */}
        <div
          className="relative flex size-12 sm:size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl sm:rounded-2xl border border-line/70 bg-logo-plate p-1 shadow-2xs"
          aria-hidden="true"
        >
          <span className="cond select-none text-xs sm:text-sm font-extrabold tracking-wide text-ink-2">
            {initials}
          </span>
          {update.organization?.logo_path ? (
            <OrganizationLogo path={update.organization.logo_path} />
          ) : null}
        </div>

        {/* Right Column: Main Content */}
        <div className="min-w-0 flex-1">
          {/* Header Row: [New] + Posted date on left, Category badge on right */}
          <div className="flex items-center justify-between gap-2">
            <UpdateCardMeta publishedAt={update.published_date ?? update.published_at} />
            <Badge
              tone={CATEGORY_TONE[category]}
              className="shrink-0 text-xs font-semibold px-2.5 py-0.5"
            >
              {CATEGORY_LABELS[category]}
            </Badge>
          </div>

          {/* Update Title */}
          <h3 className="mt-1.5 text-[0.9375rem] sm:text-base font-bold leading-snug tracking-tight text-ink line-clamp-2">
            {/* Not prefetched — see the note in `JobCard`. A list of cards is a
                set of candidates, not a set of intents. */}
            <Link
              prefetch={false}
              href={`/updates/${update.slug}`}
              className="after:absolute after:inset-0 hover:text-accent transition-colors"
            >
              {update.title}
            </Link>
          </h3>

          {/* Organization Subtitle */}
          {orgSubtitle ? (
            <p className="mt-0.5 text-xs sm:text-sm text-ink-2 line-clamp-1">{orgSubtitle}</p>
          ) : null}

          {/* Summary preview */}
          {update.summary ? (
            <p className="mt-2 line-clamp-2 text-xs sm:text-sm text-ink-2 leading-relaxed">
              {update.summary}
            </p>
          ) : null}

          {/* Bottom Chips / Pills Row */}
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            {examLabel ? (
              <span className="inline-flex max-w-[200px] truncate items-center rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-ink-2 leading-normal">
                {examLabel}
              </span>
            ) : null}

            <span className="inline-flex items-center gap-1 rounded-full border border-accent-line/60 bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent leading-normal">
              <span>{ctaText}</span>
              <span aria-hidden="true">→</span>
            </span>

            {update.tags.slice(0, 2).map((tag) => (
              <span
                key={tag}
                className="inline-flex max-w-[150px] truncate items-center rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-ink-3 leading-normal"
              >
                {tag}
              </span>
            ))}
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * Loading placeholder matching the new card shape.
 */
export function UpdateCardSkeleton({ variant = "card" }: { variant?: "row" | "card" } = {}) {
  const containerClass =
    variant === "card"
      ? "rounded-2xl border border-line bg-surface p-4 sm:p-5 shadow-xs"
      : "border-b border-line bg-surface p-4 sm:px-5 sm:py-4";

  return (
    <div className={containerClass}>
      <div className="flex items-start gap-3.5 sm:gap-4">
        {/* Logo slot skeleton */}
        <div className="skeleton size-12 sm:size-14 rounded-xl sm:rounded-2xl shrink-0" />

        {/* Content column skeleton */}
        <div className="min-w-0 flex-1">
          {/* Header row skeleton */}
          <div className="flex items-center justify-between">
            <div className="skeleton h-3.5 w-28 rounded-full" />
            <div className="skeleton h-5 w-20 rounded-full" />
          </div>

          {/* Title skeleton */}
          <div className="skeleton mt-2 h-4 sm:h-5 w-4/5" />

          {/* Subtitle skeleton */}
          <div className="skeleton mt-1.5 h-3.5 w-3/5" />

          {/* Summary skeleton */}
          <div className="skeleton mt-2 h-3 w-5/6" />

          {/* Bottom chips skeleton */}
          <div className="mt-3.5 flex flex-wrap gap-2">
            <div className="skeleton h-5 w-24 rounded-full" />
            <div className="skeleton h-5 w-32 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
