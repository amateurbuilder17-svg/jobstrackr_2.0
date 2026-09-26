import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { BuildingIcon } from "@/components/icons";
import { OrganizationLogo } from "@/components/home/organization-logo";
import { toInitials } from "@/components/home/monogram";
import { ChangeLog } from "@/components/jobs/change-log";
import { JobDeadlineChip } from "@/components/jobs/job-deadline-chip";
import { JobDetailGrid } from "@/components/jobs/job-detail-grid";
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
  todayInIndia,
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
import { sectorHubPath } from "@/lib/hubs/catalog";
import {
  getJobBySlug,
  listJobChanges,
  listJobSlugsForBuild,
  listRelatedJobs,
} from "@/lib/db/queries/jobs";
import { listUpdateLinksForJob, listUpdatesForJob } from "@/lib/db/queries/exam-updates";
import { CATEGORY_LABELS } from "@/lib/updates/categories";
import { NOINDEX_FOLLOW, isJobIndexable } from "@/lib/seo/indexing";
import { jobPostingJsonLd } from "@/lib/seo/job-jsonld";
import { breadcrumbJsonLd } from "@/lib/seo/site-jsonld";
import { toUrl } from "@/lib/sync/links";

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

  // A closed listing is still a page worth reading — the notification, the
  // vacancy table, the eligibility are all still true, and the recruitment is
  // a thing people look up long after it shut. What it must not do is read
  // like an open one. The snippet is the only part of this page most people
  // see before they decide to click, so it is where the state has to be
  // stated, in the first three words.
  const closed = job.status === "closed";

  // Written as a sentence rather than keyword soup, because this is what shows
  // under the result and it decides whether anyone clicks.
  const description = [
    closed ? "Applications closed." : null,
    org
      ? `${org} ${closed ? "invited" : "invites"} applications for ${job.title}.`
      : `${job.title}.`,
    vacancies ? `${vacancies} vacancies.` : null,
    job.qualification_summary ? `Eligibility: ${job.qualification_summary}.` : null,
    closes ? (closed ? `The last date was ${closes}.` : `Apply before ${closes}.`) : null,
  ]
    .filter(Boolean)
    .join(" ");

  // A listing closed for longer than `CLOSED_JOB_INDEX_DAYS` stops asking to be
  // indexed, and leaves the sitemap on the same day. See `lib/seo/indexing.ts`.
  const indexable = await jobIsIndexable(job.status, job.last_date);

  return {
    title: job.title,
    description,
    alternates: { canonical: `/jobs/${job.slug}` },
    ...(indexable ? {} : { robots: NOINDEX_FOLLOW }),
    openGraph: {
      title: job.title,
      description,
      url: `/jobs/${job.slug}`,
      type: "article",
      // Declaring `openGraph` here REPLACES the one the `opengraph-image.tsx`
      // file convention contributes — it does not merge into it — so a route
      // that sets an og:title and forgets this ships a preview card with no
      // image at all. That is what /jobs/[slug] and /updates/[slug] were doing:
      // the two most-shared routes on the site were the only two without the
      // share card, while every list page that declares no `openGraph` had it.
      // Verified by grepping og: tags out of the prerendered HTML.
      images: ["/opengraph-image"],
    },
  };
}

/**
 * `isJobIndexable` against today's date, in a cache scope.
 *
 * Cache Components refuses a bare `new Date()` during a render, and asks for
 * the date to be captured in a `"use cache"` scope instead. `content` is the
 * lifetime the rest of this page already has, so capturing the date here
 * cannot make the page re-render any sooner. A shorter one would drag the whole
 * route down with it; `detail-page-tags.test.ts` explains what that costs.
 *
 * Async because `"use cache"` only applies to async functions, not because
 * anything in here waits.
 */
// eslint-disable-next-line @typescript-eslint/require-await
async function jobIsIndexable(status: string, lastDate: string | null): Promise<boolean> {
  "use cache";
  cacheLife("content");
  return isJobIndexable({ status, last_date: lastDate }, todayInIndia());
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

  // Formatted here rather than inline so the notice above reads as prose.
  const closedOn = formatDate(job.last_date);

  // Every address below goes through `toUrl` on its way out. Ingest writes
  // these through it too, but rows backfilled from the old project never did,
  // and no link on this site may point at the aggregator (`lib/sync/links.ts`).
  const notificationPdf = toUrl(detail?.notification_pdf);
  const documents: QuickLink[] = notificationPdf
    ? [{ label: "Official notification (PDF)", url: notificationPdf }]
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
              {/* To the employer's hub: every other notice from the same body,
                  and one of the paths a crawler reaches this page by. */}
              {job.organization ? (
                <Link
                  href={`/organisations/${job.organization.slug}`}
                  prefetch={false}
                  className="line-clamp-1 underline-offset-4 hover:underline"
                >
                  {orgTitle}
                </Link>
              ) : (
                <span className="line-clamp-1">{orgTitle}</span>
              )}
            </div>
          ) : null}

          <h1 className="mt-1 text-xl sm:text-2xl lg:text-3xl font-extrabold leading-tight tracking-tight text-ink">
            {job.title}
          </h1>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <JobDeadlineChip date={job.last_date} />
            {job.tags.map((tag) => {
              const hub = sectorHubPath(tag);
              const chip =
                "inline-flex items-center rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-ink-2 leading-normal";
              return hub ? (
                <Link
                  key={tag}
                  href={hub}
                  prefetch={false}
                  className={`${chip} hover:border-line-strong hover:text-ink`}
                >
                  {sectorLabel(tag)}
                </Link>
              ) : (
                <span key={tag} className={chip}>
                  {sectorLabel(tag)}
                </span>
              );
            })}
          </div>
        </div>
      </header>

      {/* ── Closed listings ────────────────────────────────────────────────
          Rendered from `job.status`, not from today's date, and that is the
          whole point of it. `JobActions` and `JobDeadlineChip` both decide
          expiry on the client, because a page prerendered in June cannot know
          it is now September — so the HTML a crawler reads, and the first
          frame a visitor sees, always describes the listing as open. For a
          job that closed eight months ago that is simply wrong, and it is
          wrong in the one place it matters: the top of the page, above the
          apply button.

          `status` is a database column that ingest maintains hourly, so the
          server does know. Stating it here costs nothing at runtime, cannot
          drift out of sync with the deadline chip below it, and gives the
          ~3,753 archived listings an honest first line. */}
      {job.status === "closed" ? (
        <div role="note" className="mt-5 rounded-xl border border-line bg-surface-2 px-4 py-3">
          <p className="text-sm font-semibold text-ink">
            Applications for this post have closed
          </p>
          <p className="mt-1 text-sm text-ink-2">
            {closedOn
              ? `The last date to apply was ${closedOn}. `
              : "The application window has ended. "}
            The notification below is kept for reference.{" "}
            <Link
              href="/jobs"
              className="font-medium text-accent underline-offset-4 hover:underline"
            >
              See jobs open now
            </Link>
            .
          </p>
        </div>
      ) : null}

      <JobActions
        jobId={job.id}
        slug={job.slug}
        title={job.title}
        applyLink={toUrl(detail?.apply_link)}
        officialWebsite={toUrl(detail?.official_website) ?? toUrl(job.organization?.website)}
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
