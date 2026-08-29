import Link from "next/link";

import { DeadlineBadge } from "@/components/jobs/deadline-badge";
import { ChevronRightIcon } from "@/components/icons";
import { CardInteractive } from "@/components/ui/card";
import type { JobCard } from "@/lib/db/queries/jobs";
import { formatSalary, formatVacancies } from "@/lib/format/deadline";
import { Monogram } from "./monogram";

/**
 * The single most urgent open job, rendered large.
 *
 * "Closing soon" is a correct row and a poor lead: six rows of identical weight
 * make the reader do the ranking the sort already did. Promoting the first one
 * costs no extra query — the section fetches six and hands the first to this
 * component — and gives the page one object with a size that matches its
 * importance.
 *
 * A tinted ground rather than a shadow, for the reason in `card.tsx`: this is
 * still a record, not a floating surface. The tint says "read this one first"
 * without lifting it onto a layer above the list it belongs to.
 */
export function Spotlight({ job }: { job: JobCard }) {
  // See `vacancy-card.tsx`: the tile takes the acronym, the caption the full
  // name, so the two are never the same four letters printed twice.
  const mark = job.organization?.short_name ?? job.organization?.name;
  const org = job.organization?.name ?? job.organization?.short_name;
  const vacancies = formatVacancies(job.vacancies_display, job.vacancies);
  const salary = job.salary_display ?? formatSalary(job.salary_min, job.salary_max);
  const meta = [vacancies, salary, job.location].filter((v): v is string => Boolean(v));

  return (
    <CardInteractive className="border-accent-line bg-accent-soft/50 p-4 lg:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <Monogram name={mark} />
          <div className="min-w-0">
            <p className="cond text-2xs font-semibold tracking-wide text-accent uppercase">
              Closing next
            </p>
            {org ? <p className="truncate text-xs text-ink-2">{org}</p> : null}
          </div>
        </div>

        <DeadlineBadge date={job.last_date} />
      </div>

      <h3 className="mt-3 line-clamp-2 text-lg leading-snug font-bold text-ink lg:text-xl">
        <Link href={`/jobs/${job.slug}`} className="after:absolute after:inset-0">
          {job.title}
        </Link>
      </h3>

      {job.qualification_summary ? (
        <p className="cond mt-1 line-clamp-1 text-sm text-ink-2">{job.qualification_summary}</p>
      ) : null}

      {meta.length > 0 ? (
        // Pills rather than a `·`-joined line. Three separate facts read as
        // three facts; run together they read as one string nobody parses.
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {meta.map((item) => (
            <li
              key={item}
              className="tabular rounded-full border border-line bg-surface px-2 py-0.5 text-2xs font-medium text-ink-2"
            >
              {item}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="mt-4 inline-flex items-center gap-0.5 text-sm font-medium text-accent">
        View notification
        <ChevronRightIcon className="size-3.5" />
      </p>
    </CardInteractive>
  );
}
