import Link from "next/link";

import { DeadlineBadge } from "@/components/jobs/deadline-badge";
import { CardInteractive } from "@/components/ui/card";
import type { JobCard } from "@/lib/db/queries/jobs";
import { formatCount, formatVacancies } from "@/lib/format/deadline";
import { Monogram } from "./monogram";

/**
 * A card in the "Biggest recruitments" rail.
 *
 * The rail exists to answer one question — where are the most posts? — so the
 * vacancy figure is the largest thing on the card rather than a footnote under
 * the title. Set in the tabular face, so a column of them lines up as the
 * reader scrolls sideways and the magnitudes are comparable at a glance.
 */
export function VacancyCard({ job }: { job: JobCard }) {
  // The mark takes the acronym, the label takes the full name. Feeding both
  // from `short_name` rendered "AIIMS  AIIMS" — a tile and a caption saying the
  // same four letters, which is the failure mode of every avatar-plus-name row.
  const mark = job.organization?.short_name ?? job.organization?.name;
  const label = job.organization?.name ?? job.organization?.short_name;
  const count =
    formatVacancies(job.vacancies_display, job.vacancies) ?? formatCount(job.vacancies);

  return (
    <CardInteractive className="flex h-full flex-col p-4">
      <div className="flex items-center gap-2">
        <Monogram name={mark} className="size-8" />
        {label && label !== mark ? (
          <p className="cond min-w-0 truncate text-2xs font-medium tracking-wide text-ink-3 uppercase">
            {label}
          </p>
        ) : null}
      </div>

      {/* The number, then its unit — not "2,492 vacancies" as one string. The
          figure is what the eye is scanning for and the word is what makes it
          mean something; at the same size they compete. */}
      <p className="tabular mt-3 text-2xl leading-none font-semibold tracking-tight text-ink">
        {stripUnit(count)}
      </p>
      <p className="text-2xs font-medium tracking-wide text-ink-3 uppercase">vacancies</p>

      <h3 className="mt-2.5 line-clamp-3 flex-1 text-sm leading-snug font-semibold text-ink">
        <Link href={`/jobs/${job.slug}`} className="after:absolute after:inset-0">
          {job.title}
        </Link>
      </h3>

      <div className="mt-3">
        <DeadlineBadge date={job.last_date} />
      </div>
    </CardInteractive>
  );
}

/**
 * "2,492 vacancies" → "2,492"; "Various" → "Various".
 *
 * `vacancies_display` is free text copied from the notification, so it may
 * already carry the word, may be a range, or may be a phrase with no digits at
 * all. Only the trailing unit is removed — anything else is left alone rather
 * than parsed, because a wrong number here is worse than an untidy one.
 */
function stripUnit(value: string | null): string {
  if (!value) return "—";
  return value.replace(/\s*(vacanc(y|ies)|posts?)\s*$/i, "").trim() || value;
}
