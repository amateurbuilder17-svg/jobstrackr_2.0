import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ArrowRightIcon,
  BuildingIcon,
  CalendarIcon,
  ExternalLinkIcon,
  UserIcon,
} from "@/components/icons";
import { OrganizationLogo } from "@/components/home/organization-logo";
import { toInitials } from "@/components/home/monogram";
import { JobDeadlineChip } from "@/components/jobs/job-deadline-chip";
import { Badge } from "@/components/ui/badge";
import {
  Details,
  ImportantDates,
  LinkList,
  Overview,
  Section,
} from "@/components/updates/detail-sections";
import { FreshDot } from "@/components/updates/fresh-dot";
import { UpdateActions } from "@/components/updates/update-actions";
import { UpdateCard } from "@/components/updates/update-card";
import {
  getExamUpdateBySlug,
  listExamUpdateSlugsForBuild,
  listRelatedUpdates,
} from "@/lib/db/queries/exam-updates";
import { getJobById } from "@/lib/db/queries/jobs";
import { env } from "@/lib/env";
import { formatDate, formatVacancies } from "@/lib/format/deadline";
import { decodeEntities } from "@/lib/format/text";
import { CATEGORY_CTA, CATEGORY_LABELS, CATEGORY_TONE } from "@/lib/updates/categories";
import {
  datesFromOverview,
  datesFromSections,
  partitionUpdateDates,
  primaryLinks,
  relationTerm,
  toRelatedArticles,
  toUpdateLinks,
  toUpdateOverview,
  toUpdateSections,
} from "@/lib/updates/detail-shape";

/**
 * One exam update detail page.
 *
 * Statically generated per slug and revalidated by tag when ingest touches the row.
 * Matches the layout, hero squircle, action bar, and card architecture of the job detail page.
 */
export async function generateStaticParams() {
  return listExamUpdateSlugsForBuild();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const update = await getExamUpdateBySlug(slug);

  if (!update) return { title: "Update not found" };

  const description = decodeEntities(
    update.summary ?? `${CATEGORY_LABELS[update.category]} update for ${update.title}.`,
  );
  const title = decodeEntities(update.title);

  return {
    title,
    description,
    alternates: { canonical: `/updates/${slug}` },
    openGraph: {
      title,
      description,
      url: `${env.NEXT_PUBLIC_SITE_URL}/updates/${slug}`,
      type: "article",
      publishedTime: update.published_at ?? undefined,
    },
  };
}

export default async function UpdatePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const update = await getExamUpdateBySlug(slug);

  if (!update) notFound();

  const category = update.category;
  const title = decodeEntities(update.title);
  const date = formatDate(update.published_date ?? update.published_at);
  const checked = formatDate(update.scraped_at);

  const job = update.job_id ? await getJobById(update.job_id) : null;
  const detail = update.detail;

  const { dates: tableDates, links: harvested } = partitionUpdateDates(detail?.important_dates);
  const { dates: overviewDates, rest: overview } = datesFromOverview(
    toUpdateOverview(detail?.overview),
    tableDates,
  );
  const { dates: sectionDates, rest: sections } = datesFromSections(
    toUpdateSections(detail?.sections),
    [...tableDates, ...overviewDates],
  );
  const dates = [...tableDates, ...overviewDates, ...sectionDates];

  const links = toUpdateLinks(detail?.download_links, harvested, category);
  const related = toRelatedArticles(detail?.related_articles);
  const { action, official } = primaryLinks(links);

  const term = relationTerm(update.title);
  const siblings = term ? await listRelatedUpdates(term, slug) : [];

  const orgName = update.organization?.name.trim();
  const orgShort = update.organization?.short_name?.trim();
  const orgTitle =
    orgName && orgShort && orgName.toLowerCase() !== orgShort.toLowerCase()
      ? `${orgName} (${orgShort})`
      : (orgName ?? orgShort ?? term);

  const initials = toInitials(
    orgShort ?? orgName ?? update.exam?.short_name ?? update.exam?.name ?? "GOVT",
  );

  return (
    <article className="relative mx-auto max-w-3xl px-4 pt-6 pb-28 lg:px-6 lg:pb-12">
      {/* Top back navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/updates"
          className="inline-flex items-center gap-2 text-sm font-semibold text-ink transition-colors hover:text-ink-2"
        >
          <span className="text-base font-bold" aria-hidden="true">
            ←
          </span>
          <span>Exam Updates</span>
        </Link>
      </div>

      {/* Hero Header matching Job Details */}
      <header className="mt-4 flex items-start gap-3.5 sm:gap-5">
        {/* Left: Logo Squircle */}
        <div
          className="relative flex size-16 sm:size-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-line/70 bg-logo-plate p-2 shadow-xs"
          aria-hidden="true"
        >
          <span className="cond select-none text-base sm:text-lg font-extrabold tracking-wider text-ink-2">
            {initials}
          </span>
          {update.organization?.logo_path ? (
            <OrganizationLogo path={update.organization.logo_path} />
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
            {title}
          </h1>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <Badge
              tone={CATEGORY_TONE[category]}
              className="text-xs font-semibold px-2.5 py-0.5"
            >
              {CATEGORY_LABELS[category]}
            </Badge>

            {update.exam ? (
              <span className="inline-flex items-center rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-ink-2 leading-normal">
                {update.exam.short_name ?? update.exam.name}
              </span>
            ) : null}

            {date ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-ink-3 tabular">
                <CalendarIcon className="size-3.5" aria-hidden="true" />
                Published {date}
              </span>
            ) : null}

            <FreshDot date={update.published_date ?? update.published_at} />
          </div>
        </div>
      </header>

      {/* Action Bar (inline on desktop, sticky on mobile) */}
      <UpdateActions
        slug={slug}
        title={title}
        action={action ? { label: CATEGORY_CTA[category], url: action.url } : null}
        official={official}
      />

      {/* Summary preview */}
      {update.summary ? (
        <p className="mt-6 text-base sm:text-lg leading-relaxed text-ink-2 font-normal">
          {decodeEntities(update.summary)}
        </p>
      ) : null}

      {/* Related Job Notification (card layout) */}
      {job ? (
        <section className="mt-8">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="h-4.5 w-1 shrink-0 rounded-full bg-brand" aria-hidden="true" />
            <h2 className="text-base sm:text-lg font-bold tracking-tight text-ink">
              Related Job Notification
            </h2>
          </div>
          <Link
            href={`/jobs/${job.slug}`}
            className="group relative block rounded-2xl border border-line/80 bg-surface p-4 sm:p-5 shadow-xs transition-all duration-200 hover:border-line-strong hover:shadow-sm"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <span className="inline-flex items-center rounded-full border border-brand/20 bg-brand-soft px-2.5 py-0.5 text-xs font-medium text-brand">
                  Official Recruitment
                </span>
                <h3 className="mt-2 text-base font-bold text-ink group-hover:text-accent transition-colors line-clamp-2">
                  {decodeEntities(job.title)}
                </h3>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {formatVacancies(job.vacancies_display, job.vacancies) ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-ink-2">
                      <UserIcon className="size-3.5" aria-hidden="true" />
                      {formatVacancies(job.vacancies_display, job.vacancies)}
                    </span>
                  ) : null}
                  <JobDeadlineChip date={job.last_date} />
                </div>
              </div>
              <span className="hidden sm:flex size-8 shrink-0 items-center justify-center rounded-lg border border-line text-ink-3 group-hover:border-accent-line group-hover:bg-accent-soft group-hover:text-accent transition-colors">
                <ArrowRightIcon className="size-4" />
              </span>
            </div>
          </Link>
        </section>
      ) : null}

      <ImportantDates dates={dates} />
      <Overview rows={overview} />
      <Details sections={sections} />
      <LinkList title="Important links" links={links} />
      <LinkList title="Related articles" links={related} />

      {siblings.length > 0 ? (
        <Section title={`More ${term ?? ""} updates`.replace(/\s+/g, " ")}>
          <ul className="flex flex-col gap-3">
            {siblings.map((sibling) => (
              <li key={sibling.id}>
                <UpdateCard update={sibling} variant="card" />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {update.tags.length > 0 ? (
        <Section title="Tags">
          <ul className="flex flex-wrap gap-1.5">
            {update.tags.map((tag) => (
              <li key={tag}>
                <Badge tone="neutral">{tag}</Badge>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <footer className="mt-12 rounded-2xl border border-line/60 bg-surface-2/40 p-4 sm:p-5 text-xs text-ink-3">
        {checked ? <p className="font-medium text-ink-2">Last checked {checked}.</p> : null}
        <p className="mt-1">
          Always check the official website before acting on a date or a link.
        </p>
        <a
          href={update.source_url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="mt-2 inline-flex items-center gap-1 font-semibold text-accent hover:underline"
        >
          <span>View official source</span>
          <ExternalLinkIcon className="size-3" aria-hidden="true" />
        </a>
      </footer>
    </article>
  );
}
