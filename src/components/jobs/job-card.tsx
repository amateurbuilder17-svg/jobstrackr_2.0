import Link from "next/link";

import { UsersIcon } from "@/components/icons";
import { CardInteractive } from "@/components/ui/card";
import type { JobCard as JobCardData } from "@/lib/db/queries/jobs";
import { formatCount, formatSalary } from "@/lib/format/deadline";
import { DeadlineBadge } from "./deadline-badge";

/**
 * One job in a list.
 *
 * A Server Component with no interactive state, so none of this reaches the
 * client bundle — a list of 20 costs zero JavaScript.
 *
 * The whole card is clickable via a stretched pseudo-element on the title link
 * rather than by wrapping everything in one anchor. Wrapping means a screen
 * reader announces the entire card — organisation, deadline, salary, vacancy
 * count — as the link text, which is unusable. This way the accessible name is
 * the job title, and the click target is still the card.
 */
export function JobCard({ job }: { job: JobCardData }) {
  const vacancies = job.vacancies_display ?? formatCount(job.vacancies);
  const salary = job.salary_display ?? formatSalary(job.salary_min, job.salary_max);

  return (
    <CardInteractive className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {job.organization ? (
            <p className="truncate text-2xs font-medium tracking-wide text-ink-3 uppercase">
              {job.organization.short_name ?? job.organization.name}
            </p>
          ) : null}
          <h3 className="mt-1 text-base leading-snug font-semibold text-ink">
            <Link href={`/jobs/${job.slug}`} className="after:absolute after:inset-0">
              {job.title}
            </Link>
          </h3>
        </div>

        <DeadlineBadge date={job.last_date} />
      </div>

      <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-3">
        {vacancies ? (
          <div className="inline-flex items-center gap-1.5">
            <UsersIcon className="size-3.5" />
            <dt className="sr-only">Vacancies</dt>
            <dd className="tabular font-mono text-ink-2">{vacancies}</dd>
            <span>vacancies</span>
          </div>
        ) : null}

        {salary ? (
          <div className="inline-flex items-center gap-1.5">
            <dt className="sr-only">Salary</dt>
            <dd className="tabular font-mono text-ink-2">{salary}</dd>
          </div>
        ) : null}

        {job.location ? (
          <div>
            <dt className="sr-only">Location</dt>
            <dd>{job.location}</dd>
          </div>
        ) : null}
      </dl>
    </CardInteractive>
  );
}

/**
 * Loading placeholder.
 *
 * Deliberately the same box as the real card — 4 units of padding, a two-line
 * head, a one-line meta row. A skeleton of the wrong height is worse than none:
 * the content lands, everything below jumps, and the fallback meant to smooth
 * loading is what damages the layout-shift score.
 */
export function JobCardSkeleton() {
  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="skeleton h-3 w-24 rounded-xs" />
          <div className="skeleton mt-2 h-5 w-4/5" />
        </div>
        <div className="skeleton h-5 w-20 rounded-full" />
      </div>
      <div className="mt-3 flex gap-4">
        <div className="skeleton h-3 w-28" />
        <div className="skeleton h-3 w-24" />
      </div>
    </div>
  );
}
