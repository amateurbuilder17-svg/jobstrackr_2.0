import Link from "next/link";

import { UserIcon } from "@/components/icons";
import { OrganizationLogo } from "@/components/home/organization-logo";
import { toInitials } from "@/components/home/monogram";
import type { JobCard as JobCardData } from "@/lib/db/queries/jobs";
import { formatSalary, formatVacancies } from "@/lib/format/deadline";
import { JobBookmarkButton } from "./job-bookmark-button";
import { JobCardMeta } from "./job-card-meta";
import { JobDeadlineChip } from "./job-deadline-chip";

/** Formats organization name + abbreviation (e.g. "Institute of Banking Personnel Selection (IBPS)") */
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

/** Formats qualification into a clean pill label */
function formatQualification(raw?: string | null): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;

  if (/^eligibility differs/i.test(text)) {
    return "Check Eligibility";
  }

  const first = text.split(/[|\n;]/)[0]?.trim();
  if (first && first.length <= 32) {
    return first;
  }

  const commaClause = text.split(/[,]/)[0]?.trim();
  if (commaClause && commaClause.length <= 25) {
    return commaClause;
  }

  if (text.length > 30) {
    return text.slice(0, 28).trim() + "…";
  }

  return text;
}

/** Formats location label (e.g. "All India") */
function formatLocation(location?: string | null, state?: string | null): string {
  const loc = location?.trim();
  const st = state?.trim();

  if (loc && /all[\s-]?india/i.test(loc)) return "All India";
  if (st && /all[\s-]?india/i.test(st)) return "All India";

  if (st && (!loc || loc.toLowerCase() === st.toLowerCase())) {
    return st;
  }

  if (loc) {
    if (st && !loc.includes(st)) {
      return `${loc}, ${st}`;
    }
    return loc;
  }

  return st ?? "All India";
}

/**
 * One job in a list matching the clean, card-based visual design.
 *
 * Designed to match the app's Gazette theme:
 * - Left: Logo plate with graceful monogram/initials fallback.
 * - Right:
 *   - Header row with [New] badge, relative posted time, and top-right bookmark button.
 *   - Bold title linked via stretched pseudo-element.
 *   - Organization subtitle with acronym.
 *   - Meta stats: Vacancies with User icon • Salary range in Indian currency format.
 *   - Bottom pill rail: Qualification chip (green), Location chip (neutral), Deadline chip (urgency-colored with clock icon).
 */
export function JobCard({
  job,
  variant = "card",
}: {
  job: JobCardData;
  variant?: "row" | "card";
}) {
  const vacancies = formatVacancies(job.vacancies_display, job.vacancies);
  const salary = job.salary_display ?? formatSalary(job.salary_min, job.salary_max);
  const orgSubtitle = formatOrgSubtitle(job.organization);
  const initials = toInitials(job.organization?.short_name ?? job.organization?.name ?? "GOVT");
  const qualification = formatQualification(job.qualification_summary);
  const location = formatLocation(job.location, job.state);

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
          {job.organization?.logo_path ? (
            <OrganizationLogo path={job.organization.logo_path} />
          ) : null}
        </div>

        {/* Right Column: Main Content */}
        <div className="min-w-0 flex-1">
          {/* Header Row: [New] + Posted date on left, Bookmark on right */}
          <div className="flex items-center justify-between gap-2">
            <JobCardMeta
              publishedAt={job.published_at}
              isFeatured={job.is_featured}
            />
            <JobBookmarkButton jobId={job.id} title={job.title} />
          </div>

          {/* Job Title */}
          <h3 className="mt-1.5 text-[0.9375rem] sm:text-base font-bold leading-snug tracking-tight text-ink line-clamp-2">
            <Link
              href={`/jobs/${job.slug}`}
              className="after:absolute after:inset-0 hover:text-accent transition-colors"
            >
              {job.title}
            </Link>
          </h3>

          {/* Organization Subtitle */}
          {orgSubtitle ? (
            <p className="mt-0.5 text-xs sm:text-sm text-ink-2 line-clamp-1">
              {orgSubtitle}
            </p>
          ) : null}

          {/* Meta stats row: Vacancies and Salary */}
          {vacancies || salary ? (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-ink-3 tabular">
              {vacancies ? (
                <>
                  <UserIcon className="size-3.5 shrink-0 text-ink-3" aria-hidden="true" />
                  <span>{vacancies}</span>
                </>
              ) : null}
              {vacancies && salary ? (
                <span className="text-ink-3/50" aria-hidden="true">•</span>
              ) : null}
              {salary ? <span>{salary}</span> : null}
            </div>
          ) : null}

          {/* Bottom Chips / Pills Row */}
          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            {qualification ? (
              <span className="inline-flex max-w-[200px] truncate items-center rounded-full border border-good/20 bg-good-soft px-2.5 py-0.5 text-xs font-medium text-good leading-normal">
                {qualification}
              </span>
            ) : null}

            {location ? (
              <span className="inline-flex max-w-[150px] truncate items-center rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-ink-2 leading-normal">
                {location}
              </span>
            ) : null}

            <JobDeadlineChip date={job.last_date} />
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * Loading placeholder matching the new card shape.
 */
export function JobCardSkeleton({ variant = "card" }: { variant?: "row" | "card" } = {}) {
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
            <div className="skeleton size-5 rounded-md" />
          </div>

          {/* Title skeleton */}
          <div className="skeleton mt-2 h-4 sm:h-5 w-4/5" />

          {/* Subtitle skeleton */}
          <div className="skeleton mt-1.5 h-3.5 w-3/5" />

          {/* Meta skeleton */}
          <div className="skeleton mt-2 h-3 w-2/5" />

          {/* Bottom chips skeleton */}
          <div className="mt-3.5 flex flex-wrap gap-2">
            <div className="skeleton h-5 w-24 rounded-full" />
            <div className="skeleton h-5 w-16 rounded-full" />
            <div className="skeleton h-5 w-28 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
