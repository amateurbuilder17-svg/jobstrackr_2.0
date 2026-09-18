import Link from "next/link";
import type { ReactNode } from "react";

import { ChevronRightIcon, UserIcon } from "@/components/icons";
import { JobDeadlineChip } from "@/components/jobs/job-deadline-chip";
import { Badge } from "@/components/ui/badge";
import type { ExamUpdateCard } from "@/lib/db/queries/exam-updates";
import type { JobCard } from "@/lib/db/queries/jobs";
import { formatVacancies } from "@/lib/format/deadline";
import { decodeEntities } from "@/lib/format/text";
import { CATEGORY_LABELS } from "@/lib/updates/categories";

/**
 * The "what to read next" strips at the foot of an update page.
 *
 * ── Rows, not cards ───────────────────────────────────────────────────────
 * The obvious build is the card rail the home page uses, and it is the wrong
 * one here. These strips exist to be a crawl path and an exit: what matters is
 * how many titled links fit above the fold of a thumb-scroll, and a card costs
 * roughly four times the markup of a row to show the same headline. Across
 * ~5,300 statically generated pages that difference is measured in gigabytes of
 * origin transfer, which is a bill this project has already paid once. Rows
 * also read better — a stack of headlines is a list of stories, and a sideways
 * rail of cards is furniture people swipe past.
 *
 * Each strip's heading carries its own "See all" into the filtered feed, which
 * is the fresh surface: the rails themselves are cached on the three-day
 * `content` window that keeps detail pages off the ISR-write treadmill, so
 * "latest" here means "latest as of this page's last render".
 */

function RailHeader({
  title,
  href,
  linkLabel,
}: {
  title: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-4">
      <div className="flex items-center gap-2.5">
        <span className="h-4.5 w-1 shrink-0 rounded-full bg-brand" aria-hidden="true" />
        <h2 className="text-base font-bold tracking-tight text-ink sm:text-lg">{title}</h2>
      </div>
      <Link
        href={href}
        className="group inline-flex shrink-0 items-center gap-0.5 text-sm font-medium text-accent hover:underline"
      >
        {linkLabel}
        <ChevronRightIcon className="size-3.5 transition-transform duration-(--duration-fast) group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}

function RailList({ children }: { children: ReactNode }) {
  return (
    <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
      {children}
    </ul>
  );
}

/**
 * A strip of update headlines.
 *
 * The category badge is kept even on a single-category rail. It is redundant
 * against the heading by one reading and load-bearing by another: these strips
 * sit below the fold, where a reader arrives mid-scroll with the heading long
 * gone off the top of the screen.
 */
export function UpdateRail({
  title,
  href,
  linkLabel,
  updates,
}: {
  title: string;
  href: string;
  linkLabel: string;
  updates: readonly ExamUpdateCard[];
}) {
  if (updates.length === 0) return null;

  return (
    <section className="mt-12">
      <RailHeader title={title} href={href} linkLabel={linkLabel} />
      <RailList>
        {updates.map((update) => (
          <li key={update.id}>
            <Link
              href={`/updates/${update.slug}`}
              className="flex items-center gap-3 px-4 py-3 text-sm transition-colors duration-(--duration-fast) hover:bg-surface-2"
            >
              <Badge className="shrink-0">{CATEGORY_LABELS[update.category]}</Badge>
              <span className="min-w-0 flex-1 truncate text-ink">
                {decodeEntities(update.title)}
              </span>
              <ChevronRightIcon className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </RailList>
    </section>
  );
}

/**
 * A strip of open recruitments.
 *
 * The cross-silo link, and the only place on this page where someone reading
 * about an exam that has already happened is offered one they can still apply
 * to. It carries a deadline chip for exactly that reason — the rail's claim is
 * "still open", and a date is what makes the claim checkable.
 */
export function JobRail({
  title,
  href,
  linkLabel,
  jobs,
}: {
  title: string;
  href: string;
  linkLabel: string;
  jobs: readonly JobCard[];
}) {
  if (jobs.length === 0) return null;

  return (
    <section className="mt-12">
      <RailHeader title={title} href={href} linkLabel={linkLabel} />
      <RailList>
        {jobs.map((job) => {
          const vacancies = formatVacancies(job.vacancies_display, job.vacancies);

          return (
            <li key={job.id}>
              <Link
                href={`/jobs/${job.slug}`}
                className="flex flex-col gap-1.5 px-4 py-3 text-sm transition-colors duration-(--duration-fast) hover:bg-surface-2"
              >
                <span className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate font-medium text-ink">
                    {decodeEntities(job.title)}
                  </span>
                  <ChevronRightIcon className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  {vacancies ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-3">
                      <UserIcon className="size-3.5" aria-hidden="true" />
                      {vacancies}
                    </span>
                  ) : null}
                  <JobDeadlineChip date={job.last_date} />
                </span>
              </Link>
            </li>
          );
        })}
      </RailList>
    </section>
  );
}
