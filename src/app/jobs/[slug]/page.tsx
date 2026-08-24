import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { JobCard, JobCardSkeleton } from "@/components/jobs/job-card";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { env } from "@/lib/env";
import { formatCount, formatDate, formatSalary } from "@/lib/format/deadline";
import { DeadlineBadge } from "@/components/jobs/deadline-badge";
import { getJobBySlug, listJobSlugsForBuild, listRelatedJobs } from "@/lib/db/queries/jobs";
import { listUpdatesForJob } from "@/lib/db/queries/exam-updates";
import { jobPostingJsonLd } from "@/lib/seo/job-jsonld";

/**
 * Job detail.
 *
 * Every published slug is prerendered at build and re-rendered only when its
 * cache tag is invalidated. That is what makes the SEO surface free: a crawler
 * walking 5,000 job pages reads 5,000 static files and issues no database
 * queries at all. The old app answered each of those hits with a serverless
 * function and a Supabase round trip.
 */

/**
 * Which slugs to prerender at build.
 *
 * Failure here degrades rather than breaks. If the database is unreachable —
 * a blip, a paused project, a CI run with placeholder credentials — the build
 * still succeeds with nothing prerendered, and pages render on first request
 * and cache from then on. The alternative is a deploy that fails because
 * Supabase was briefly slow, which trades a small, self-healing performance
 * dip for a complete outage.
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

  const vacancies = job.vacancies_display ?? formatCount(job.vacancies);
  const salary = job.salary_display ?? formatSalary(job.salary_min, job.salary_max);
  const applyLink = job.detail?.apply_link ?? job.organization?.website ?? null;

  const facts = [
    { label: "Vacancies", value: vacancies },
    { label: "Salary", value: salary },
    { label: "Qualification", value: job.qualification_summary },
    {
      label: "Age limit",
      value:
        job.age_min !== null && job.age_max !== null
          ? `${String(job.age_min)}–${String(job.age_max)} years`
          : null,
    },
    { label: "Location", value: job.location },
    {
      label: "Application fee",
      value:
        job.application_fee === 0
          ? "No fee"
          : job.application_fee !== null
            ? `₹${String(job.application_fee)}`
            : null,
    },
    { label: "Opens", value: formatDate(job.application_start_date) },
    { label: "Closes", value: formatDate(job.last_date) },
  ].filter((f) => f.value);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 lg:px-6">
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
        <span className="text-ink-2">{job.organization?.short_name ?? "Listing"}</span>
      </nav>

      <header className="mt-3">
        {job.organization ? (
          <p className="text-2xs font-medium tracking-wide text-ink-3 uppercase">
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

      {/* Shown regardless of whether the window has closed: this page is
          static, so it cannot know today's date, and hiding the link at build
          time would hide it permanently. The badge above carries the status. */}
      {applyLink ? (
        <a
          href={applyLink}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className={
            "mt-5 inline-flex h-11 items-center rounded-lg bg-accent px-6 text-sm font-medium " +
            "text-on-accent shadow-xs transition-colors duration-(--duration-fast) " +
            "hover:bg-accent-hover"
          }
        >
          Apply on the official site
        </a>
      ) : null}

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

      {job.detail?.description ? (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-ink">About this recruitment</h2>
          <p className="mt-2 leading-relaxed text-ink-2">{job.detail.description}</p>
        </section>
      ) : null}

      {job.detail?.eligibility_text ? (
        <section className="mt-6">
          <h2 className="text-lg font-semibold text-ink">Eligibility</h2>
          <p className="mt-2 leading-relaxed text-ink-2">{job.detail.eligibility_text}</p>
        </section>
      ) : null}

      {/* Rails stream in separately: neither is needed for the page to be
          useful, so neither should delay it appearing. */}
      <Suspense fallback={<RailSkeleton title="Related updates" />}>
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

async function UpdatesRail({ jobId }: { jobId: string }) {
  const updates = await listUpdatesForJob(jobId, 5);
  if (updates.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-ink">Related updates</h2>
      <ul className="mt-3 flex flex-col divide-y divide-line rounded-lg border border-line bg-surface">
        {updates.map((update) => (
          <li key={update.id}>
            <Link
              href={`/updates/${update.slug}`}
              className="block px-4 py-3 text-sm transition-colors duration-(--duration-fast) hover:bg-surface-2"
            >
              <span className="text-ink">{update.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
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
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-ink">More from this department</h2>
      <ul className="mt-3 flex flex-col gap-3">
        {jobs.map((job) => (
          <li key={job.id}>
            <JobCard job={job} />
          </li>
        ))}
      </ul>
    </section>
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
