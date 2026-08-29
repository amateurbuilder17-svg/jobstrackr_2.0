import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ChangeLog } from "@/components/jobs/change-log";
import { DeadlineBadge } from "@/components/jobs/deadline-badge";
import {
  ApplicationFees,
  ImportantDates,
  Overview,
  Prose,
  QuickLinks,
  Section,
  SelectionProcess,
  VacancyBreakdown,
  type QuickLink,
} from "@/components/jobs/detail-sections";
import { JobActions } from "@/components/jobs/job-actions";
import { JobCard, JobCardSkeleton } from "@/components/jobs/job-card";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { env } from "@/lib/env";
import {
  formatCount,
  formatDate,
  formatDeadlineText,
  formatSalary,
  formatVacancies,
} from "@/lib/format/deadline";
import { maxFee, toFeeRows } from "@/lib/jobs/detail-shape";
import {
  getJobBySlug,
  listJobChanges,
  listJobSlugsForBuild,
  listRelatedJobs,
} from "@/lib/db/queries/jobs";
import { listUpdateLinksForJob, listUpdatesForJob } from "@/lib/db/queries/exam-updates";
import { CATEGORY_LABELS } from "@/lib/updates/categories";
import { jobPostingJsonLd } from "@/lib/seo/job-jsonld";

/**
 * Job detail.
 *
 * Every published slug is prerendered at build and re-rendered only when its
 * cache tag is invalidated. That is what makes the SEO surface free: a crawler
 * walking 5,000 job pages reads 5,000 static files and issues no database
 * queries at all. The old app answered each of those hits with a serverless
 * function and a Supabase round trip.
 *
 * ── What this page owes the reader ────────────────────────────────────────
 * The old app's job page was its best screen: it printed everything the
 * notification said — the fee table, the vacancy breakdown, the selection
 * stages, every date — and put Apply and Track within thumb reach. This page
 * had the same data available in `job_details` from the first day and rendered
 * none of it, because nothing was writing that table (see Module 13).
 *
 * The rebuilt version keeps the completeness and drops the cost. Every section
 * below is a Server Component; the only JavaScript on this route is the action
 * bar, which exists because a static document cannot know today's date, who is
 * reading it, or whether their device can share.
 */

export async function generateStaticParams() {
  return listJobSlugsForBuild();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const job = await getJobBySlug(slug);
  if (!job) return { title: "Job not found" };

  const org = job.organization?.name;
  const vacancies = formatCount(job.vacancies);
  const closes = formatDate(job.last_date);

  // Written as a sentence rather than keyword soup, because this is what shows
  // under the result and it decides whether anyone clicks.
  const description = [
    org ? `${org} invites applications for ${job.title}.` : `${job.title}.`,
    vacancies ? `${vacancies} vacancies.` : null,
    job.qualification_summary ? `Eligibility: ${job.qualification_summary}.` : null,
    closes ? `Apply before ${closes}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    title: job.title,
    description,
    alternates: { canonical: `/jobs/${job.slug}` },
    openGraph: {
      title: job.title,
      description,
      url: `/jobs/${job.slug}`,
      type: "article",
    },
  };
}

export default async function JobDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const job = await getJobBySlug(slug);
  if (!job) notFound();

  const detail = job.detail;
  const vacancies = formatVacancies(job.vacancies_display, job.vacancies);
  const salary = job.salary_display ?? formatSalary(job.salary_min, job.salary_max);

  // The typed column first, then the fee table. A notification that prints a
  // table of concessional rates and no single figure is normal, and "not
  // stated" would be the wrong answer to "what will this cost me".
  const fee =
    job.application_fee === 0
      ? "No fee"
      : job.application_fee !== null
        ? `₹${String(job.application_fee)}`
        : formatFallbackFee(detail?.application_fees ?? null);

  const facts = [
    { label: "Vacancies", value: vacancies },
    { label: "Salary", value: salary },
    { label: "Qualification", value: job.qualification_summary },
    { label: "Age limit", value: formatAgeLimit(job.age_min, job.age_max) },
    { label: "Location", value: job.location },
    { label: "Application fee", value: fee },
    { label: "Opens", value: formatDate(job.application_start_date) },
    { label: "Closes", value: formatDeadlineText(job.last_date_display, job.last_date) },
  ].filter((f) => f.value);

  const documents: QuickLink[] = detail?.notification_pdf
    ? [{ label: "Official notification (PDF)", url: detail.notification_pdf }]
    : [];

  return (
    // `relative` so the share confirmation can position against this column
    // rather than against the viewport. `pb-28` on mobile clears the fixed
    // action bar; without it the last section sits underneath it.
    <div className="relative mx-auto max-w-3xl px-4 pt-8 pb-28 lg:px-6 lg:pb-12">
      {/* Emitted server-side so a crawler sees it in the initial HTML. */}
      <script
        type="application/ld+json"
        // Content is built from typed database columns, not user input.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(jobPostingJsonLd(job, env.NEXT_PUBLIC_SITE_URL)),
        }}
      />

      <nav aria-label="Breadcrumb" className="text-xs text-ink-3">
        <Link href="/jobs" className="hover:text-ink-2 hover:underline">
          Jobs
        </Link>
        <span aria-hidden> / </span>
        <span className="text-ink-2">
          {job.organization?.short_name ?? job.organization?.name ?? "Listing"}
        </span>
      </nav>

      <header className="mt-3">
        {job.organization ? (
          <p className="cond text-2xs font-medium tracking-wide text-ink-3 uppercase">
            {job.organization.name}
          </p>
        ) : null}
        <h1 className="mt-1.5 text-2xl leading-tight font-semibold tracking-tight text-ink lg:text-3xl">
          {job.title}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <DeadlineBadge date={job.last_date} />
          {job.tags.map((tag) => (
            <Badge key={tag}>{tag}</Badge>
          ))}
        </div>
      </header>

      <JobActions
        jobId={job.id}
        slug={job.slug}
        title={job.title}
        applyLink={detail?.apply_link ?? null}
        officialWebsite={detail?.official_website ?? job.organization?.website ?? null}
        lastDate={job.last_date}
        lastDateDisplay={job.last_date_display}
      />

      <Card className="mt-6 p-0">
        <dl className="divide-y divide-line">
          {facts.map((fact) => (
            <div key={fact.label} className="flex gap-4 px-4 py-3 text-sm">
              <dt className="w-32 shrink-0 text-ink-3">{fact.label}</dt>
              <dd className="tabular min-w-0 text-ink">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {/* Above the prose deliberately: someone returning to a listing they
          saved is asking what moved, not what the post is. */}
      <ChangeLog changes={await listJobChanges(job.id)} />

      {detail?.description ? (
        <Section title="About this recruitment">
          <Prose text={detail.description} />
        </Section>
      ) : null}

      {detail?.eligibility_text ? (
        <Section title="Eligibility">
          <Prose text={detail.eligibility_text} />
        </Section>
      ) : null}

      {detail?.experience_text ? (
        <Section title="Experience">
          <Prose text={detail.experience_text} />
        </Section>
      ) : null}

      {/* The typed age window is the unrelaxed one — `match_jobs` says so, and
          never applies a relaxation. This paragraph is the only place someone
          eligible through OBC or SC/ST relaxation can read that. */}
      {detail?.age_limit_text ? (
        <Section title="Age limit in full">
          <Prose text={detail.age_limit_text} />
        </Section>
      ) : null}

      {detail?.salary_text ? (
        <Section title="Pay and allowances">
          <Prose text={detail.salary_text} />
        </Section>
      ) : null}

      <ImportantDates value={detail?.important_dates ?? null} />
      <VacancyBreakdown value={detail?.vacancies_detail ?? null} />
      <ApplicationFees value={detail?.application_fees ?? null} />
      <SelectionProcess value={detail?.selection_process ?? null} />
      <Overview value={detail?.overview ?? null} />
      <QuickLinks links={documents} />

      {/* Rails stream in separately: none is needed for the page to be useful,
          so none should delay it appearing. */}
      <Suspense fallback={null}>
        <UpdateDocuments jobId={job.id} />
      </Suspense>

      {/* No skeleton: most jobs have no linked updates, and a heading that
          paints and then vanishes is a layout shift advertising something that
          was never there. The rail renders its own heading once it has rows. */}
      <Suspense fallback={null}>
        <UpdatesRail jobId={job.id} />
      </Suspense>

      {job.organization ? (
        <Suspense fallback={<RailSkeleton title="More from this department" />}>
          <RelatedRail organizationSlug={job.organization.slug} excludeSlug={job.slug} />
        </Suspense>
      ) : null}
    </div>
  );
}

/** "18–27 years", "Up to 30 years", or nothing. */
function formatAgeLimit(min: number | null, max: number | null): string | null {
  if (min !== null && max !== null) {
    return min === max ? `${String(min)} years` : `${String(min)}–${String(max)} years`;
  }
  if (min !== null) return `From ${String(min)} years`;
  if (max !== null) return `Up to ${String(max)} years`;
  return null;
}

function formatFallbackFee(value: unknown): string | null {
  const highest = maxFee(toFeeRows(value));
  if (highest === null) return null;
  // `maxFee` returns 0 for a table whose every line is "Nil" — an answer, and
  // one that must not be rendered as "Up to ₹0".
  return highest === 0 ? "No fee" : `Up to ₹${String(highest)}`;
}

/**
 * Admit cards, answer keys and results, from the updates linked to this job.
 *
 * Someone opening a job page a month after applying is looking for a document,
 * not a description. The old app surfaced these too — through a title-similarity
 * scan costing ~44 kB per page view, because `job_id` was populated on three
 * rows out of 3,373. This is a foreign-key lookup, resolved at ingest.
 */
async function UpdateDocuments({ jobId }: { jobId: string }) {
  const updates = await listUpdateLinksForJob(jobId);
  if (updates.length === 0) return null;

  const links: QuickLink[] = updates.flatMap((update) =>
    update.links.map((link) => ({
      label: link.label,
      url: link.url,
      category: CATEGORY_LABELS[update.category],
    })),
  );

  return <QuickLinks links={links} />;
}

async function UpdatesRail({ jobId }: { jobId: string }) {
  const updates = await listUpdatesForJob(jobId, 5);
  if (updates.length === 0) return null;

  return (
    <Section title="Related updates">
      <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {updates.map((update) => (
          <li key={update.id}>
            <Link
              href={`/updates/${update.slug}`}
              className="flex items-center gap-3 px-4 py-3 text-sm transition-colors duration-(--duration-fast) hover:bg-surface-2"
            >
              <Badge className="shrink-0">{CATEGORY_LABELS[update.category]}</Badge>
              <span className="min-w-0 flex-1 truncate text-ink">{update.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

async function RelatedRail({
  organizationSlug,
  excludeSlug,
}: {
  organizationSlug: string;
  excludeSlug: string;
}) {
  const jobs = await listRelatedJobs(organizationSlug, excludeSlug, 4);
  if (jobs.length === 0) return null;

  return (
    <Section title="More from this department">
      <ul className="overflow-hidden rounded-lg border border-line border-b-0">
        {jobs.map((job) => (
          <li key={job.id}>
            <JobCard job={job} />
          </li>
        ))}
      </ul>
    </Section>
  );
}

function RailSkeleton({ title }: { title: string }) {
  return (
    <section className="mt-8" aria-busy="true">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <div className="mt-3 flex flex-col gap-3">
        <JobCardSkeleton />
      </div>
    </section>
  );
}
