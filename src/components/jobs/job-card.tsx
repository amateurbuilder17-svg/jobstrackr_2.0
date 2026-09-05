import Link from "next/link";

import { UserIcon } from "@/components/icons";
import { OrganizationLogo } from "@/components/home/organization-logo";
import { toInitials } from "@/components/home/monogram";
import type { JobCard as JobCardData } from "@/lib/db/queries/jobs";
import { formatVacancies } from "@/lib/format/deadline";
import { resolveSalary } from "@/lib/format/salary";
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

/** Formats qualification into a clean, concise pill label (e.g. "Graduate", "12th Pass", "B.Tech") */
function formatQualification(raw?: string | null): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;

  if (/^eligibility differs/i.test(text)) {
    return "Check Notice";
  }

  // Common qualification patterns in Indian recruitment notices
  if (/b\.?sc\s+nursing/i.test(text)) return "B.Sc Nursing";
  if (/10th|matric\b/i.test(text)) return "10th Pass";
  if (/12th|intermediate|class 12|hsc|higher secondary/i.test(text)) return "12th Pass";
  if (/b\.?tech|b\.?e\b/i.test(text)) return "B.Tech / B.E.";
  if (/b\.?sc\b.*diploma|diploma.*b\.?sc\b/i.test(text)) return "B.Sc / Diploma";
  if (/diploma/i.test(text)) return "Diploma";
  if (/b\.?sc\b/i.test(text)) return "B.Sc";
  if (/b\.?com\b/i.test(text)) return "B.Com";
  if (/bba\b/i.test(text)) return "BBA";
  if (/mba\b/i.test(text)) return "MBA";
  if (/m\.?tech|m\.?e\b/i.test(text)) return "M.Tech";
  if (/post[\s-]?graduate|postgraduation|master'?s/i.test(text)) return "Post Graduate";
  if (/graduate|graduation|bachelor'?s/i.test(text)) return "Graduate";
  if (/iti\b/i.test(text)) return "ITI";
  if (/phd|doctorate/i.test(text)) return "PhD";
  if (/llb|law/i.test(text)) return "Law / LLB";
  if (/mbbs/i.test(text)) return "MBBS";
  if (/ca\b|chartered/i.test(text)) return "CA";

  // If already reasonably short
  const first = text.split(/[|\n;,]/)[0]?.trim();
  if (first && first.length <= 18) {
    return first;
  }

  return "Check Notice";
}

/** Formats location label (e.g. "All India", "Bhubaneswar", "Mumbai") */
function formatLocation(location?: string | null, state?: string | null): string {
  const loc = location?.trim();
  const st = state?.trim();

  if (loc && /all[\s-]?india/i.test(loc)) return "All India";
  if (st && /all[\s-]?india/i.test(st)) return "All India";

  if (loc && loc.length <= 16) return loc;
  if (st && st.length <= 16) return st;
  if (loc) {
    const city = loc.split(/[,/]/)[0]?.trim();
    if (city && city.length <= 14) return city;
  }

  return loc ?? st ?? "All India";
}

/**
 * Compact, highly space-efficient job card.
 *
 * Header: Logo + Title + Org + Bookmark + Vacancies/Salary.
 * Footer: "Posted x days ago" + Qualification / Location / Deadline pills across full card width.
 */
export function JobCard({
  job,
  variant = "card",
}: {
  job: JobCardData;
  variant?: "row" | "card";
}) {
  const vacancies = formatVacancies(job.vacancies_display, job.vacancies);
  const salary = resolveSalary(job.salary_display, job.salary_min, job.salary_max);
  const orgSubtitle = formatOrgSubtitle(job.organization);
  const initials = toInitials(job.organization?.short_name ?? job.organization?.name ?? "GOVT");
  const qualification = formatQualification(job.qualification_summary);
  const location = formatLocation(job.location, job.state);

  const containerClass =
    variant === "card"
      ? "relative rounded-2xl border border-line/80 bg-surface p-3.5 sm:p-4 shadow-xs transition-all duration-200 hover:border-line-strong hover:shadow-sm focus-within:border-accent-line"
      : "relative border-b border-line bg-surface p-3.5 sm:px-4 sm:py-3.5 transition-colors duration-150 hover:bg-surface-2/70 focus-within:bg-surface-2/70";

  return (
    <article className={containerClass}>
      {/* Top Section: Logo + Title + Org + Bookmark + Vacancies/Salary */}
      <div className="flex items-start gap-3 sm:gap-3.5">
        {/* Left: Organization Logo Slot */}
        <div
          className="relative flex size-11 sm:size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-line/70 bg-logo-plate p-1 shadow-2xs"
          aria-hidden="true"
        >
          <span className="cond select-none text-xs font-extrabold tracking-wide text-ink-2">
            {initials}
          </span>
          {job.organization?.logo_path ? (
            <OrganizationLogo path={job.organization.logo_path} />
          ) : null}
        </div>

        {/* Right: Main Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              {/* Job Title */}
              <h3 className="text-[0.9375rem] sm:text-base font-bold leading-snug tracking-tight text-ink line-clamp-2">
                {/* Not prefetched, and this is the single biggest lever on how
                    fast this app feels. Next prefetches every `<Link>` that
                    scrolls into view; a job detail payload is ~44 kB, so one
                    settled view of /jobs was pulling ~444 kB of pages nobody
                    had asked for — over the same connection the search box was
                    waiting on, which is most of why typing there felt slow. A
                    list is a set of candidates, not a set of intents. The one
                    card that does get tapped can afford its own round trip. */}
                <Link
                  prefetch={false}
                  href={`/jobs/${job.slug}`}
                  className="after:absolute after:inset-0 hover:text-accent transition-colors"
                >
                  {job.title}
                </Link>
              </h3>

              {/* Organization Subtitle */}
              {orgSubtitle ? (
                <p className="mt-0.5 text-xs text-ink-3 line-clamp-1">{orgSubtitle}</p>
              ) : null}
            </div>

            {/* Bookmark button positioned at top-right */}
            <JobBookmarkButton jobId={job.id} title={job.title} />
          </div>

          {/* Meta stats: Vacancies and Salary */}
          {vacancies || salary ? (
            <div className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-ink-2 tabular">
              {vacancies ? (
                <>
                  <UserIcon className="size-3.5 shrink-0 text-ink-3" aria-hidden="true" />
                  <span>{vacancies}</span>
                </>
              ) : null}
              {vacancies && salary ? (
                <span className="text-ink-3/40" aria-hidden="true">
                  •
                </span>
              ) : null}
              {salary ? <span>{salary}</span> : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* Middle: Compact Pills Row across full card width */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-line/40 pt-2.5">
        {qualification ? (
          <span className="inline-flex items-center rounded-full border border-good/25 bg-good-soft px-2 py-0.5 text-[11px] font-medium text-good leading-normal">
            {qualification}
          </span>
        ) : null}

        {location ? (
          <span className="inline-flex items-center rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-ink-2 leading-normal">
            {location}
          </span>
        ) : null}

        <JobDeadlineChip date={job.last_date} />
      </div>

      {/* Very Bottom: Posted at / Posted x days ago */}
      <div className="mt-2 flex items-center justify-between text-[11px] text-ink-3">
        <JobCardMeta publishedAt={job.published_at} isFeatured={job.is_featured} />
      </div>
    </article>
  );
}

/**
 * Loading placeholder matching the new compact, two-tier card shape.
 */
export function JobCardSkeleton({ variant = "card" }: { variant?: "row" | "card" } = {}) {
  const containerClass =
    variant === "card"
      ? "rounded-2xl border border-line bg-surface p-3.5 sm:p-4 shadow-xs"
      : "border-b border-line bg-surface p-3.5 sm:px-4 sm:py-3.5";

  return (
    <div className={containerClass}>
      <div className="flex items-start gap-3 sm:gap-3.5">
        <div className="skeleton size-11 sm:size-12 rounded-xl shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="skeleton h-4 sm:h-5 w-4/5" />
            <div className="skeleton size-5 rounded-md shrink-0" />
          </div>
          <div className="skeleton mt-1.5 h-3.5 w-3/5" />
          <div className="skeleton mt-1.5 h-3.5 w-2/5" />
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5 border-t border-line/40 pt-2.5">
        <div className="skeleton h-4.5 w-16 rounded-full" />
        <div className="skeleton h-4.5 w-16 rounded-full" />
        <div className="skeleton h-4.5 w-20 rounded-full" />
      </div>
      <div className="mt-2">
        <div className="skeleton h-3 w-24 rounded-full" />
      </div>
    </div>
  );
}
