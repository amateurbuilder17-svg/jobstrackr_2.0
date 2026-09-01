import Link from "next/link";
import { ChevronRightIcon } from "@/components/icons";
import { cn } from "@/lib/cn";
import type { ExamAttempt } from "@/lib/db/queries/attempts";
import type { ExamUpdateCard as ExamUpdateCardData } from "@/lib/db/queries/exam-updates";
import type { PopularExam } from "@/lib/db/queries/exams";
import type { JobCard as JobCardData } from "@/lib/db/queries/jobs";
import { formatDate, formatSalary, formatVacancies } from "@/lib/format/deadline";
import { STATUS_LABELS, type AttemptStatus } from "@/lib/tracker/enums";
import { DeadlineBadge, OrganizationBadge, ProgressRing } from "./primitives";

export function TrackedExamCard({ attempt }: { attempt: ExamAttempt }) {
  const status = attempt.status as AttemptStatus;
  const urgent = status === "admit_card" || status === "tracking";
  const name =
    attempt.exam?.name ??
    attempt.custom_name ??
    attempt.job?.title ??
    "Tracked exam";
  const org =
    attempt.exam?.short_name ??
    attempt.exam?.name.slice(0, 5) ??
    attempt.job?.title.slice(0, 5) ??
    "EXAM";
  const dateStr = formatDate(attempt.exam_date) ?? "No date yet";
  const href = attempt.job ? `/jobs/${attempt.job.slug}` : "/tracker";

  // Calculate rough stage progress
  let stagesDone = 2;
  const stagesTotal = 5;
  if (status === "tracking") stagesDone = 1;
  else if (status === "applied") stagesDone = 2;
  else if (status === "admit_card" || status === "appeared") stagesDone = 3;
  else if (status === "passed" || status === "failed") stagesDone = 5;

  const currentStage = attempt.stage ?? STATUS_LABELS[status];

  return (
    <Link
      href={href}
      className={cn(
        "group relative block w-[288px] shrink-0 snap-start rounded-2xl border border-border bg-card p-3.5 text-left shadow-card",
        "transition-all duration-200 ease-out hover:border-brand/25 hover:shadow-card-hover active:scale-[0.99]",
      )}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <OrganizationBadge org={org} size="sm" />
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold",
                urgent ? "bg-warning-soft text-warning" : "bg-brand-soft text-brand-deep",
              )}
            >
              {STATUS_LABELS[status]}
            </span>
          </div>
          <h3 className="mt-2 line-clamp-2 text-[14px] font-bold leading-snug tracking-tight text-foreground group-hover:text-brand transition-colors">
            {name}
          </h3>
          <p className="mt-0.5 text-[12px] tabular-nums text-muted-foreground">{dateStr}</p>
        </div>
        <ProgressRing value={stagesDone} total={stagesTotal} label="Stages" size="sm" />
      </div>
      <p className="mt-2.5 truncate text-[11.5px] text-muted-foreground border-t border-border/50 pt-2">
        Current stage · <span className="font-semibold text-foreground">{currentStage}</span>
      </p>
    </Link>
  );
}

export function PopularExamCard({ exam }: { exam: PopularExam }) {
  const org = exam.short_name ?? exam.name.slice(0, 5);
  const trackersLabel =
    exam.tracked >= 1000
      ? `${(exam.tracked / 1000).toFixed(1)}k tracking`
      : `${String(exam.tracked)} tracking`;

  return (
    <Link
      href={`/calendar?exam=${exam.slug}`}
      className={cn(
        "group flex w-[140px] shrink-0 snap-start flex-col gap-2 rounded-2xl border border-border bg-card p-3.5 text-left shadow-card",
        "transition-all duration-200 ease-out hover:border-brand/25 hover:shadow-card-hover active:scale-[0.99]",
      )}
    >
      <OrganizationBadge org={org} size="sm" />
      <span className="line-clamp-2 text-[12.5px] font-bold leading-snug text-foreground group-hover:text-brand transition-colors">
        {exam.name}
      </span>
      <span className="mt-auto text-[11.5px] tabular-nums text-muted-foreground">
        {trackersLabel}
      </span>
    </Link>
  );
}

export function JobCard({
  job,
  compact = false,
}: {
  job: JobCardData;
  compact?: boolean;
}) {
  const org = job.organization?.short_name ?? job.organization?.name ?? "GOVT";
  const orgFull = job.organization?.name ?? job.organization?.short_name ?? "";
  const vacancies = formatVacancies(job.vacancies_display, job.vacancies);
  const salary = job.salary_display ?? formatSalary(job.salary_min, job.salary_max);
  const meta = [vacancies, salary, job.location].filter(Boolean).join(" · ");

  return (
    <Link
      href={`/jobs/${job.slug}`}
      className={cn(
        "group relative block rounded-2xl border border-border bg-card p-4 text-left shadow-card",
        "transition-all duration-200 ease-out hover:border-brand/25 hover:shadow-card-hover active:scale-[0.99]",
      )}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-3">
        <OrganizationBadge org={org} size="sm" />
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold leading-snug tracking-tight text-foreground group-hover:text-brand transition-colors">
            {job.title}
          </h3>
          <p className="mt-0.5 line-clamp-1 text-[12.5px] text-muted-foreground">
            {[orgFull, job.qualification_summary].filter(Boolean).join(" · ")}
          </p>
          {!compact && meta ? (
            <p className="mt-1.5 line-clamp-1 text-[12.5px] tabular-nums text-muted-foreground">
              {meta}
            </p>
          ) : null}
          <DeadlineBadge date={job.last_date} className="mt-2.5" />
        </div>
        <ChevronRightIcon
          className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </div>
    </Link>
  );
}

export function ClosingSoonCard({ job }: { job: JobCardData }) {
  const mark = job.organization?.short_name ?? job.organization?.name ?? "GOVT";
  const org = job.organization?.name ?? job.organization?.short_name ?? "Official Board";
  const vacancies = formatVacancies(job.vacancies_display, job.vacancies);
  const salary = job.salary_display ?? formatSalary(job.salary_min, job.salary_max);
  const chips = [vacancies, salary, job.location].filter(Boolean);

  return (
    <Link
      href={`/jobs/${job.slug}`}
      className={cn(
        "group relative block w-[320px] shrink-0 snap-start rounded-2xl border border-brand/25 bg-brand-soft/70 p-3.5 text-left shadow-card",
        "transition-all duration-200 ease-out hover:bg-brand-soft active:scale-[0.99]",
      )}
    >
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <OrganizationBadge org={mark} size="sm" className="bg-card" />
          <p className="truncate max-w-[150px] text-[13px] font-semibold text-foreground">{org}</p>
        </div>
        <DeadlineBadge date={job.last_date} />
      </div>

      <h3 className="mt-2 line-clamp-1 text-[14.5px] font-extrabold leading-snug tracking-tight text-foreground group-hover:text-brand transition-colors">
        {job.title}
      </h3>

      {job.qualification_summary ? (
        <p className="mt-0.5 line-clamp-1 text-[12px] text-muted-foreground">
          {job.qualification_summary}
        </p>
      ) : null}

      {chips.length > 0 ? (
        <div className="mt-2.5 rounded-xl border border-border/70 bg-card p-2 shadow-2xs">
          <ul className="flex flex-wrap items-center gap-1.5">
            {chips.map((chip) => (
              <li
                key={chip}
                className="tabular-nums rounded-lg bg-muted/60 px-2 py-0.5 text-[11.5px] font-medium text-foreground"
              >
                {chip}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-2.5 flex items-center gap-1 text-[12px] font-bold text-brand-deep group-hover:text-brand transition-colors">
        <span>View notification</span>
        <ChevronRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </div>
    </Link>
  );
}

export function ExamUpdateCard({ update }: { update: ExamUpdateCardData }) {
  const org =
    update.organization?.short_name ??
    update.organization?.name.slice(0, 5) ??
    update.exam?.short_name ??
    "EXAM";
  const dateStr = formatDate(update.published_date ?? update.published_at) ?? "";
  const categoryLabel = update.category
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <Link
      href={`/exam-update/${update.slug}`}
      className={cn(
        "group relative block rounded-2xl border border-border bg-card p-4 text-left shadow-card",
        "transition-all duration-200 ease-out hover:border-brand/25 hover:shadow-card-hover active:scale-[0.99]",
      )}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3">
        <OrganizationBadge org={org} size="sm" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-secondary-foreground">
              {categoryLabel}
            </span>
            {dateStr ? (
              <span className="text-[12px] tabular-nums text-muted-foreground">{dateStr}</span>
            ) : null}
          </div>
          <h3 className="mt-2 text-[14.5px] font-bold leading-snug tracking-tight text-foreground group-hover:text-brand transition-colors">
            {update.title}
          </h3>
          {update.summary ? (
            <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
              {update.summary}
            </p>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
