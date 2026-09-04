import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { BuildingIcon } from "@/components/icons";
import { OrganizationLogo } from "@/components/home/organization-logo";
import { toInitials } from "@/components/home/monogram";
import { ChangeLog } from "@/components/jobs/change-log";
import { JobDeadlineChip } from "@/components/jobs/job-deadline-chip";
import { isLongQualification, JobDetailGrid } from "@/components/jobs/job-detail-grid";
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
import { env } from "@/lib/env";
import {
  formatCount,
  formatDate,
  formatDeadlineText,
  formatVacancies,
} from "@/lib/format/deadline";
import { resolveSalary } from "@/lib/format/salary";
import {
  maxFee,
  toFeeRows,
  toImportantDates,
  toVacancyTable,
  totalVacancies,
} from "@/lib/jobs/detail-shape";
import { sectorLabel } from "@/lib/jobs/sectors";
import {
  getJobBySlug,
  listJobChanges,
  listJobSlugsForBuild,
  listRelatedJobs,
} from "@/lib/db/queries/jobs";
import { listUpdateLinksForJob, listUpdatesForJob } from "@/lib/db/queries/exam-updates";
import { CATEGORY_LABELS } from "@/lib/updates/categories";
import { jobPostingJsonLd } from "@/lib/seo/job-jsonld";
import { breadcrumbJsonLd } from "@/lib/seo/site-jsonld";

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
  // Same fallback as the page body, so the search result and the page agree.
  const vacancies = formatCount(
    job.vacancies ?? totalVacancies(toVacancyTable(job.detail?.vacancies_detail ?? null)),
  );
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

  // The typed column first, then the breakdown table — the same fallback the
  // fee below uses, and for the same reason. A notification whose vacancy count
  // is only stated inside its own table is normal, and "Check notice" is the
  // wrong answer to print two sections above a table that says 24.
  //
  // The card query cannot do this (the breakdown lives in the cold table), so
  // ingest writes the same figure into `jobs.vacancies` for the listing pages;
  // see `vacanciesFromTable`. This line is what makes the detail page right for
  // rows written before that, without waiting for a re-ingest.
  const vacancies = formatVacancies(
    job.vacancies_display,
    job.vacancies ?? totalVacancies(toVacancyTable(detail?.vacancies_detail ?? null)),
  );
  // `salary_text` is the sentence the typed columns were parsed out of, so it
  // is where a misread pay-matrix level ("Level-2 … Initial Pay Rs. 19,900/-",
  // stored as `salary_min = 2`) can still be recovered as real pay. Only this
  // page has it — the listings load the card columns alone.
  const salary = resolveSalary(
    job.salary_display,
    job.salary_min,
    job.salary_max,
    detail?.salary_text ?? null,
  );

  // The grid cell clamps a long qualification summary. Whatever it cut has to
  // be readable somewhere, and the Eligibility section is that somewhere: for
  // 53 of the 60 longest summaries sampled in production `eligibility_text`
  // holds the identical string, so the section usually already prints it and
  // repeating it would be noise. The three cases below are the ones that are
  // not identical.
  const eligibilityText = detail?.eligibility_text?.trim()
    ? detail.eligibility_text.trim()
    : null;
  const qualificationText = job.qualification_summary?.trim()
    ? job.qualification_summary.trim()
    : null;
  const collapse = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
  const qualificationSaidElsewhere =
    eligibilityText !== null &&
    qualificationText !== null &&
    collapse(eligibilityText).includes(collapse(qualificationText));
  const qualificationInFull =
    qualificationText !== null &&
    !qualificationSaidElsewhere &&
    // A summary short enough to be printed whole in the cell needs no second
    // rendering; only what the cell cut does.
    isLongQualification(qualificationText)
      ? qualificationText
      : null;

  // The typed column first, then the fee table. A notification that prints a
  // table of concessional rates and no single figure is normal, and "not
  // stated" would be the wrong answer to "what will this cost me".
  const fee =
    job.application_fee === 0
      ? "No fee"
      : job.application_fee !== null
        ? `₹${String(job.application_fee)}`
        : formatFallbackFee(detail?.application_fees ?? null);

  const importantDates = toImportantDates(detail?.important_dates ?? null);
  const admitCardEntry = importantDates.find((d) =>
    /admit[\s-]?card|hall[\s-]?ticket/i.test(d.event),
  );
  const examEntry = importantDates.find((d) => /exam/i.test(d.event));
  const admitCardDate = admitCardEntry?.date ?? (examEntry ? `Exam: ${examEntry.date}` : null);

  const orgName = job.organization?.name.trim();
  const orgShort = job.organization?.short_name?.trim();
  const orgTitle =
    orgName && orgShort && orgName.toLowerCase() !== orgShort.toLowerCase()
      ? `${orgName} (${orgShort})`
      : (orgName ?? orgShort ?? null);
  const initials = toInitials(orgShort ?? orgName ?? "GOVT");

  const documents: QuickLink[] = detail?.notification_pdf
    ? [{ label: "Official notification (PDF)", url: detail.notification_pdf }]
    : [];

  return (
    // `relative` so the share confirmation can position against this column
    // rather than against the viewport. `pb-28` on mobile clears the fixed
    // action bar; without it the last section sits underneath it.
    <div className="relative mx-auto max-w-3xl px-4 pt-6 pb-28 lg:px-6 lg:pb-12">
      {/* Emitted server-side so a crawler sees it in the initial HTML.
          One script holding an array rather than two scripts: JSON-LD permits
          it, and the breadcrumb is only ever read alongside the posting. */}
      <script
        type="application/ld+json"
        // Content is built from typed database columns, not user input.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify([
            jobPostingJsonLd(job, env.NEXT_PUBLIC_SITE_URL),
            breadcrumbJsonLd(env.NEXT_PUBLIC_SITE_URL, [
              { name: "Jobs", path: "/jobs" },
              { name: job.title },
            ]),
          ]),
        }}
      />

      {/* Top back navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/jobs"
          className="inline-flex items-center gap-2 text-sm font-semibold text-ink transition-colors hover:text-ink-2"
        >
          <span className="text-base font-bold" aria-hidden="true">
            ←
          </span>
          <span>Job Details</span>
        </Link>
      </div>

      {/* Hero Header */}
      <header className="mt-4 flex items-start gap-3.5 sm:gap-5">
        {/* Left: Logo Squircle */}
        <div
          className="relative flex size-16 sm:size-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-line/70 bg-logo-plate p-2 shadow-xs"
          aria-hidden="true"
        >
          <span className="cond select-none text-base sm:text-lg font-extrabold tracking-wider text-ink-2">
            {initials}
          </span>
          {job.organization?.logo_path ? (
            <OrganizationLogo path={job.organization.logo_path} />
          ) : null}
        </div>

        {/* Right: Info */}
        <div className="min-w-0 flex-1">
          {orgTitle ? (
            <div className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-brand">
              <BuildingIcon className="size-4 shrink-0" aria-hidden="true" />
              <span className="line-clamp-1">{orgTitle}</span>
            </div>
          ) : null}

          <h1 className="mt-1 text-xl sm:text-2xl lg:text-3xl font-extrabold leading-tight tracking-tight text-ink">
            {job.title}
          </h1>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <JobDeadlineChip date={job.last_date} />
            {job.tags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-ink-2 leading-normal"
              >
                {sectorLabel(tag)}
              </span>
            ))}
          </div>
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

      {/* 3x3 Key Facts Table Card */}
      <JobDetailGrid
        vacancies={vacancies}
        salary={salary}
        qualification={job.qualification_summary}
        ageLimit={formatAgeLimit(job.age_min, job.age_max)}
        location={job.location ?? job.state}
        fee={fee}
        opensOn={formatDate(job.application_start_date)}
        closesOn={formatDeadlineText(job.last_date_display, job.last_date)}
        admitCard={admitCardDate}
      />

      {/* Above the prose deliberately: someone returning to a listing they
          saved is asking what moved, not what the post is. */}
      <ChangeLog changes={await listJobChanges(job.id)} />

      {detail?.description ? (
        <Section title="About this recruitment">
          <Prose text={detail.description} />
        </Section>
      ) : null}

      {/* The descriptive form of what the Qualification cell shows clamped.
          `id` is what that cell's "Read in full" link points at. */}
      {eligibilityText || qualificationInFull ? (
        <Section title="Eligibility" id="eligibility">
          {eligibilityText ? <Prose text={eligibilityText} /> : null}
          {qualificationInFull ? (
            <>
              {eligibilityText ? (
                <h3 className="mt-5 mb-2 text-sm font-bold text-ink">Qualification</h3>
              ) : null}
              <Prose text={qualificationInFull} />
            </>
          ) : null}
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
      <ul className="flex flex-col gap-3">
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
    <Section title={title}>
      <div className="flex flex-col gap-3" aria-busy="true">
        <JobCardSkeleton />
      </div>
    </Section>
  );
}
