"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { ChevronRightIcon } from "@/components/icons";
import type { ExamAttempt } from "@/lib/db/queries/attempts";
import type { ExamUpdateCard as ExamUpdateCardData } from "@/lib/db/queries/exam-updates";
import type { PopularExam } from "@/lib/db/queries/exams";
import type { JobCard as JobCardData } from "@/lib/db/queries/jobs";
import type { MatchedJob } from "@/lib/db/queries/match";
import { daysUntil } from "@/lib/format/deadline";
import {
  ClosingSoonCard,
  ExamUpdateCard,
  JobCard,
  PopularExamCard,
  TrackedExamCard,
} from "./cards";
import { useHomeSearch } from "./home-search-context";
import { SectionHeader } from "./primitives";

function matchesQualification(job: JobCardData, qualFilters: string[]): boolean {
  if (qualFilters.length === 0) return true;
  const summary = (job.qualification_summary ?? "").toLowerCase();
  const title = job.title.toLowerCase();
  const fullText = `${summary} ${title}`;

  return qualFilters.some((filter) => {
    const f = filter.toLowerCase();
    if (f.includes("10")) return fullText.includes("10") || fullText.includes("matric");
    if (f.includes("12")) return fullText.includes("12") || fullText.includes("inter");
    if (f.includes("graduate"))
      return (
        fullText.includes("graduate") ||
        fullText.includes("degree") ||
        fullText.includes("bachelor")
      );
    if (f.includes("engineering"))
      return (
        fullText.includes("engineer") || fullText.includes("b.tech") || fullText.includes("b.e")
      );
    if (f.includes("diploma")) return fullText.includes("diploma");
    if (f.includes("post graduate"))
      return (
        fullText.includes("post graduate") ||
        fullText.includes("master") ||
        fullText.includes("m.tech")
      );
    return fullText.includes(f);
  });
}

function matchesDeadline(job: JobCardData, deadlineFilters: string[]): boolean {
  if (deadlineFilters.length === 0) return true;
  const days = daysUntil(job.last_date);
  if (days === null || days < 0) return false;

  return deadlineFilters.some((filter) => {
    const f = filter.toLowerCase();
    if (f.includes("today")) return days === 0;
    if (f.includes("3 days")) return days <= 3;
    if (f.includes("month")) return days <= 30;
    return true;
  });
}

function matchesLocation(job: JobCardData, locationFilters: string[]): boolean {
  if (locationFilters.length === 0) return true;
  const loc = (job.location ?? "All India").toLowerCase();

  return locationFilters.some((filter) => {
    const f = filter.toLowerCase();
    if (f.includes("all india")) return true;
    return loc.includes(f);
  });
}

/**
 * The exams this reader is tracking.
 *
 * Unfiltered, and that is the point: this row is the reader's own shelf, not a
 * slice of the database. The qualification and deadline chips describe openings
 * to apply for; hiding an exam already being tracked because its qualification
 * chip is unticked would be answering a question nobody asked.
 */
export function TrackedExamsFeed({ attempts }: { attempts: ExamAttempt[] }) {
  return (
    <section aria-labelledby="tracked-exams-heading">
      <SectionHeader
        id="tracked-exams-heading"
        title="Your exams"
        subtitle="Everything you are tracking"
        actionLabel="My exams"
        href="/tracker"
      />
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar snap-x scroll-pl-4 scroll-px-4">
        {attempts.map((attempt) => (
          <TrackedExamCard key={attempt.id} attempt={attempt} />
        ))}
      </div>
    </section>
  );
}

/**
 * The filter chips, split into the three groups the cards can answer.
 *
 * Four feeds ran the same three `filter()` calls inline. One hook keeps the
 * chip vocabulary in a single place, so a chip added to the search bar cannot
 * silently stop working in one section and keep working in the others.
 */
const QUALIFICATION_CHIPS = [
  "Class 10",
  "Class 12",
  "Graduate",
  "Engineering",
  "Diploma",
  "Post Graduate",
];
const DEADLINE_CHIPS = ["Closing today", "Within 3 days", "This month"];
const LOCATION_CHIPS = [
  "All India",
  "Maharashtra",
  "Odisha",
  "Bihar",
  "Delhi",
  "Uttar Pradesh",
];

/**
 * Narrows a row to the chips that are ticked.
 *
 * Text search used to run here too, against the same arrays. It searched the
 * ~30 cards these six sections happen to hold, out of ~2,700 open jobs — so a
 * department with nothing in the closing-soon or just-published window came
 * back as "No matches found", which reads as *there is nothing* rather than
 * *not on this page*. Search now leaves for `/jobs` the moment the field is
 * touched (see `HomeSearchBar`) and reaches Postgres against the whole table.
 *
 * The chips stayed because they are honest about their scope: they refine rows
 * that are already on screen, and every card they hide is a card the reader can
 * see was there.
 */
function useJobFilter<T extends JobCardData>(jobs: T[], filters: string[]): T[] {
  return useMemo(() => {
    if (filters.length === 0) return jobs;

    const qual = filters.filter((f) => QUALIFICATION_CHIPS.includes(f));
    const deadline = filters.filter((f) => DEADLINE_CHIPS.includes(f));
    const location = filters.filter((f) => LOCATION_CHIPS.includes(f));

    return jobs.filter(
      (job) =>
        matchesQualification(job, qual) &&
        matchesDeadline(job, deadline) &&
        matchesLocation(job, location),
    );
  }, [jobs, filters]);
}

/**
 * Openings this person meets every stated requirement for.
 *
 * The one row on the home page that is about the reader rather than about the
 * database, which is why it sits directly under their tracked exams: someone
 * signed in came back for their own deadlines, not to browse.
 *
 * Rendered with the same `JobCard` boxes as "Just published" — a matched job
 * and a new job are the same object and should not be two different shapes on
 * one page. The header says which list this is; the cards do not need to.
 *
 * Only three rows are fetched. The full ranked feed lives at /for-you and both
 * links go there; pulling twenty to render three is the exact habit the
 * rebuild removed.
 */
export function MatchedForYouFeed({ jobs }: { jobs: MatchedJob[] }) {
  const { filters, registerResults, unregisterResults } = useHomeSearch();
  const filtered = useJobFilter(jobs, filters);

  useEffect(() => {
    registerResults("matched-for-you", filtered.length);
    return () => {
      unregisterResults("matched-for-you");
    };
  }, [filtered.length, registerResults, unregisterResults]);

  if (filtered.length === 0) return null;

  return (
    <section aria-labelledby="matched-for-you-heading">
      <SectionHeader
        id="matched-for-you-heading"
        title="Matched to your profile"
        subtitle="Age, qualification and stream all check out"
        actionLabel="For You"
        href="/for-you"
      />
      <div className="space-y-3">
        {filtered.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
      </div>
      <Link
        href="/for-you"
        className="mt-3 flex items-center justify-end gap-1 rounded-lg px-2 py-1.5 text-card-sm font-bold text-brand transition-colors duration-200 hover:bg-brand-soft"
      >
        View all matched exams
        <ChevronRightIcon className="size-[clamp(0.75rem,2.9vw,0.875rem)]" aria-hidden="true" />
      </Link>
    </section>
  );
}

export function ClosingSoonFeed({ jobs }: { jobs: JobCardData[] }) {
  const { filters, registerResults, unregisterResults } = useHomeSearch();

  const filtered = useJobFilter(jobs, filters);

  useEffect(() => {
    registerResults("closing-soon", filtered.length);
    return () => {
      unregisterResults("closing-soon");
    };
  }, [filtered.length, registerResults, unregisterResults]);

  if (filtered.length === 0) return null;

  return (
    <section aria-labelledby="closing-soon-heading">
      <SectionHeader
        id="closing-soon-heading"
        title="Closing soon"
        subtitle="Application windows shutting first"
        actionLabel="See all"
        href="/jobs"
      />
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar snap-x scroll-pl-4 scroll-px-4">
        {filtered.map((job) => (
          <ClosingSoonCard key={job.id} job={job} />
        ))}
      </div>
    </section>
  );
}

export function JustPublishedFeed({ jobs }: { jobs: JobCardData[] }) {
  const { filters, registerResults, unregisterResults } = useHomeSearch();

  const filtered = useJobFilter(jobs, filters);

  useEffect(() => {
    registerResults("just-published", filtered.length);
    return () => {
      unregisterResults("just-published");
    };
  }, [filtered.length, registerResults, unregisterResults]);

  if (filtered.length === 0) return null;

  return (
    <section aria-labelledby="just-published-heading">
      <SectionHeader
        id="just-published-heading"
        title="Just published"
        subtitle="Fresh recruitment notifications from official boards"
        actionLabel="View all"
        href="/jobs?sort=newest"
      />
      <div className="space-y-3">
        {filtered.map((job) => (
          <JobCard key={job.id} job={job} />
        ))}
      </div>
    </section>
  );
}

export function PopularExamsFeed({ exams }: { exams: PopularExam[] }) {
  const { filters } = useHomeSearch();

  // An exam is not an opening, so it has no qualification, deadline or location
  // for the chips to test. Rather than let the row sit there ignoring a filter
  // the reader just ticked, it steps aside until the filters are cleared.
  if (filters.length > 0) return null;

  return (
    <section aria-labelledby="popular-exams-heading">
      <SectionHeader
        id="popular-exams-heading"
        title="Popular exams"
        subtitle="Most tracked by aspirants this month"
      />
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar snap-x scroll-pl-4 scroll-px-4">
        {exams.map((exam) => (
          <PopularExamCard key={exam.id} exam={exam} />
        ))}
      </div>
    </section>
  );
}

/**
 * Admit cards, answer keys and results.
 *
 * Unfiltered, like the tracked row above: an update is an announcement, not a
 * vacancy, so none of the three chip groups has anything to say about one.
 * Searching them is what `/updates` is for, and its own field is in the top bar
 * on that route.
 */
export function LatestUpdatesFeed({ updates }: { updates: ExamUpdateCardData[] }) {
  return (
    <section aria-labelledby="latest-updates-heading">
      <SectionHeader
        id="latest-updates-heading"
        title="Latest updates"
        subtitle="Admit cards, answer keys and results"
        actionLabel="View all"
        href="/updates"
      />
      <div className="space-y-3">
        {updates.map((update) => (
          <ExamUpdateCard key={update.id} update={update} />
        ))}
      </div>
    </section>
  );
}
