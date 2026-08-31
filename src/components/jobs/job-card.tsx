import Link from "next/link";

import { CardInteractive, Row } from "@/components/ui/card";
import type { JobCard as JobCardData } from "@/lib/db/queries/jobs";
import { formatSalary, formatVacancies } from "@/lib/format/deadline";
import { DeadlineBadge } from "./deadline-badge";

/**
 * One job in a list.
 *
 * A Server Component. The only thing that crosses into the client bundle is the
 * deadline badge, which has to, because a countdown cannot be computed at build
 * time on a page that is served from the CDN for days. Twenty rows therefore
 * ship one badge component, not twenty copies of a row.
 *
 * The whole row is clickable via a stretched pseudo-element on the title link
 * rather than by wrapping everything in one anchor. Wrapping means a screen
 * reader announces the entire row — organisation, deadline, salary, vacancy
 * count — as the link text, which is unusable. This way the accessible name is
 * the job title, and the click target is still the row.
 *
 * ── Why this order ────────────────────────────────────────────────────────
 * Title first and loudest, because it is what someone scanning a list is
 * matching against. The organisation used to hold that position, set in
 * uppercase above the title, where it truncated mid-word on anything as long as
 * "Indian Institute of Information Technology Design and Manufacturing
 * Kancheepuram" — the most prominent line on the row was the one nobody was
 * looking for, rendered unreadably. It now sits below the title in the
 * condensed face, which fits it.
 *
 * Then one eligibility line, then the muted meta. The deadline is the only
 * coloured thing, which is the whole point of the palette.
 */
export function JobCard({
  job,
  variant = "row",
}: {
  job: JobCardData;
  variant?: "row" | "card";
}) {
  const vacancies = formatVacancies(job.vacancies_display, job.vacancies);
  const salary = job.salary_display ?? formatSalary(job.salary_min, job.salary_max);
  const org = job.organization?.short_name ?? job.organization?.name;

  // Organisation and qualification read as one sentence — "who, and what you
  // need" — so they share a line rather than each claiming their own.
  const eligibility = [org, job.qualification_summary].filter(Boolean).join(" · ");
  const meta = [vacancies, salary, job.location].filter(Boolean);

  const Wrapper = variant === "card" ? CardInteractive : Row;

  return (
    <Wrapper className="px-4 py-2 lg:px-5 lg:py-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {/* Two lines, then ellipsis. Source titles run to sixty words —
              unclamped, one row filled half a phone screen. */}
          <h3 className="line-clamp-2 text-[0.9375rem] leading-snug font-bold text-ink">
            <Link href={`/jobs/${job.slug}`} className="after:absolute after:inset-0">
              {job.title}
            </Link>
          </h3>

          {eligibility ? (
            <p className="cond mt-0.5 line-clamp-1 text-[0.8125rem] text-ink-2">
              {eligibility}
            </p>
          ) : null}

          {meta.length > 0 ? (
            <p className="tabular mt-0.5 line-clamp-1 text-xs text-ink-3">
              {meta.join("  ·  ")}
            </p>
          ) : null}
        </div>

        {/* Deadline only. The save control used to sit under it, which stacked
            two elements down the right edge and cost the row an entire line of
            height — on a phone that is the difference between five jobs above
            the fold and six. Saving lives on the detail page, where the
            decision to save is actually made, and it is not a 44px target
            wedged inside a scrolling row where it invites mis-taps. */}
        <DeadlineBadge date={job.last_date} />
      </div>
    </Wrapper>
  );
}

/**
 * Loading placeholder.
 *
 * Deliberately the same box as the real row — same padding, a two-line head, an
 * eligibility line, a meta line. A skeleton of the wrong height is worse than
 * none: the content lands, everything below jumps, and the fallback meant to
 * smooth loading is what damages the layout-shift score.
 */
export function JobCardSkeleton() {
  return (
    <div className="border-b border-line bg-surface px-4 py-2 lg:px-5 lg:py-2.5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="skeleton h-4 w-4/5" />
          <div className="skeleton mt-1 h-3 w-3/5" />
          <div className="skeleton mt-1 h-3 w-2/5" />
        </div>
        <div className="skeleton h-5 w-20 rounded-full" />
      </div>
    </div>
  );
}
