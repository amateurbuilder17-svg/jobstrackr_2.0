"use client";

import { useEffect, useMemo } from "react";
import type { ExamAttempt } from "@/lib/db/queries/attempts";
import type { ExamUpdateCard as ExamUpdateCardData } from "@/lib/db/queries/exam-updates";
import type { PopularExam } from "@/lib/db/queries/exams";
import type { JobCard as JobCardData } from "@/lib/db/queries/jobs";
import { daysUntil } from "@/lib/format/deadline";
import { STATUS_LABELS, type AttemptStatus } from "@/lib/tracker/enums";
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
    if (f.includes("graduate")) return fullText.includes("graduate") || fullText.includes("degree") || fullText.includes("bachelor");
    if (f.includes("engineering")) return fullText.includes("engineer") || fullText.includes("b.tech") || fullText.includes("b.e");
    if (f.includes("diploma")) return fullText.includes("diploma");
    if (f.includes("post graduate")) return fullText.includes("post graduate") || fullText.includes("master") || fullText.includes("m.tech");
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

export function TrackedExamsFeed({ attempts }: { attempts: ExamAttempt[] }) {
  const { query, registerResults, unregisterResults } = useHomeSearch();

  const filtered = useMemo(() => {
    if (!query) return attempts;
    return attempts.filter((attempt) => {
      const name = attempt.exam?.name ?? attempt.custom_name ?? attempt.job?.title ?? "";
      const org = attempt.exam?.short_name ?? "";
      const status = attempt.status ? STATUS_LABELS[attempt.status as AttemptStatus] : "";
      const text = `${name} ${org} ${status}`.toLowerCase();
      return text.includes(query);
    });
  }, [attempts, query]);

  useEffect(() => {
    registerResults("tracked-exams", filtered.length);
    return () => {
      unregisterResults("tracked-exams");
    };
  }, [filtered.length, registerResults, unregisterResults]);

  if (filtered.length === 0) return null;

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
        {filtered.map((attempt) => (
          <TrackedExamCard key={attempt.id} attempt={attempt} />
        ))}
      </div>
    </section>
  );
}

export function ClosingSoonFeed({ jobs }: { jobs: JobCardData[] }) {
  const { query, filters, registerResults, unregisterResults } = useHomeSearch();

  const qualFilters = useMemo(
    () => filters.filter((f) => ["Class 10", "Class 12", "Graduate", "Engineering", "Diploma", "Post Graduate"].includes(f)),
    [filters],
  );
  const deadlineFilters = useMemo(
    () => filters.filter((f) => ["Closing today", "Within 3 days", "This month"].includes(f)),
    [filters],
  );
  const locationFilters = useMemo(
    () => filters.filter((f) => ["All India", "Maharashtra", "Odisha", "Bihar", "Delhi", "Uttar Pradesh"].includes(f)),
    [filters],
  );

  const filtered = useMemo(() => {
    return jobs.filter((job) => {
      if (query) {
        const text = `${job.title} ${job.organization?.name ?? ""} ${job.organization?.short_name ?? ""} ${job.qualification_summary ?? ""} ${job.location ?? ""}`.toLowerCase();
        if (!text.includes(query)) return false;
      }
      return (
        matchesQualification(job, qualFilters) &&
        matchesDeadline(job, deadlineFilters) &&
        matchesLocation(job, locationFilters)
      );
    });
  }, [jobs, query, qualFilters, deadlineFilters, locationFilters]);

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
  const { query, filters, registerResults, unregisterResults } = useHomeSearch();

  const qualFilters = useMemo(
    () => filters.filter((f) => ["Class 10", "Class 12", "Graduate", "Engineering", "Diploma", "Post Graduate"].includes(f)),
    [filters],
  );
  const deadlineFilters = useMemo(
    () => filters.filter((f) => ["Closing today", "Within 3 days", "This month"].includes(f)),
    [filters],
  );
  const locationFilters = useMemo(
    () => filters.filter((f) => ["All India", "Maharashtra", "Odisha", "Bihar", "Delhi", "Uttar Pradesh"].includes(f)),
    [filters],
  );

  const filtered = useMemo(() => {
    return jobs.filter((job) => {
      if (query) {
        const text = `${job.title} ${job.organization?.name ?? ""} ${job.organization?.short_name ?? ""} ${job.qualification_summary ?? ""} ${job.location ?? ""}`.toLowerCase();
        if (!text.includes(query)) return false;
      }
      return (
        matchesQualification(job, qualFilters) &&
        matchesDeadline(job, deadlineFilters) &&
        matchesLocation(job, locationFilters)
      );
    });
  }, [jobs, query, qualFilters, deadlineFilters, locationFilters]);

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
  const { query, filters } = useHomeSearch();

  // Show popular exams when not filtering by text/filters
  if (query || filters.length > 0) return null;

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

export function LatestUpdatesFeed({ updates }: { updates: ExamUpdateCardData[] }) {
  const { query, registerResults, unregisterResults } = useHomeSearch();

  const filtered = useMemo(() => {
    if (!query) return updates;
    return updates.filter((update) => {
      const text = `${update.title} ${update.organization?.name ?? ""} ${update.category} ${update.summary ?? ""}`.toLowerCase();
      return text.includes(query);
    });
  }, [updates, query]);

  useEffect(() => {
    registerResults("latest-updates", filtered.length);
    return () => {
      unregisterResults("latest-updates");
    };
  }, [filtered.length, registerResults, unregisterResults]);

  if (filtered.length === 0) return null;

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
        {filtered.map((update) => (
          <ExamUpdateCard key={update.id} update={update} />
        ))}
      </div>
    </section>
  );
}
