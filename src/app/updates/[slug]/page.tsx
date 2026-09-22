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
import { JobRail, UpdateRail } from "@/components/updates/related-rails";
import { ShareRow } from "@/components/updates/share-row";
import { TrackExamsCta } from "@/components/updates/track-cta";
import { UpdateActions } from "@/components/updates/update-actions";
import { UpdateCard } from "@/components/updates/update-card";
import {
  getExamUpdateBySlug,
  listExamUpdateSlugsForBuild,
  listLatestInCategory,
  listRelatedUpdates,
} from "@/lib/db/queries/exam-updates";
import { getJobById, listOpenJobsMatching } from "@/lib/db/queries/jobs";
import { env } from "@/lib/env";
import { NOINDEX_FOLLOW, isUpdateIndexable } from "@/lib/seo/indexing";
import { breadcrumbJsonLd } from "@/lib/seo/site-jsonld";
import { examUpdateJsonLd, updateRailsJsonLd } from "@/lib/seo/update-jsonld";
import { formatDate, formatVacancies } from "@/lib/format/deadline";
import { decodeEntities } from "@/lib/format/text";
import { CATEGORY_CTA, CATEGORY_LABELS, CATEGORY_TONE } from "@/lib/updates/categories";
import { pickRailRows, takenSlugs } from "@/lib/updates/rails";
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
    // A recruitment notice restates a job that has its own page here, so it
    // steps aside for that page. It is also left out of the sitemap; see
    // `lib/seo/indexing.ts`.
    ...(isUpdateIndexable(update) ? {} : { robots: NOINDEX_FOLLOW }),
    openGraph: {
      title,
      description,
      url: `${env.NEXT_PUBLIC_SITE_URL}/updates/${slug}`,
      type: "article",
      publishedTime: update.published_at ?? undefined,
      // See the matching note on /jobs/[slug]. It matters more here than there:
      // the share row below sends this URL to WhatsApp and Telegram, both of
      // which render a link with no og:image as a bare line of text.
      images: ["/opengraph-image"],
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

  /*
   * What the job rail searches for, and what its heading says.
   *
   * The organisation's short name first, `relationTerm` second. That order is
   * the opposite of the sibling rail's above, and deliberately so.
   * `relationTerm` reads an acronym off the front of the title, which works
   * when a source writes "BPSC Assistant Executive Engineer 2025 Exam Date" and
   * does not when it writes "Exam Date Announced for BPSC …" — there the first
   * two words are the event, and the term comes back as "Exam Date". As a
   * sibling-matching heuristic that is merely weak; as the subject of a heading
   * reading "Open Exam Date vacancies", over a list of unrelated jobs that
   * happen to mention an exam date, it is wrong in a way a reader can see.
   *
   * `organizations.short_name` is a resolved foreign key rather than a guess at
   * the title, so when it is there it is both the better search term and the
   * only one fit to print. Ingest populates `organization_id` on updates (see
   * `sync/updates.ts`), so this is the normal path and the term is the fallback.
   */
  const jobRailSubject = orgShort ?? term;

  /*
   * The three cross-page rails.
   *
   * All three are cached under keys that do NOT include this page's slug — the
   * category for the two update rails, the organisation for the job rail — so
   * the ~5,300 pages of this route share a handful of cache entries between
   * them rather than holding one apiece. That is what makes them affordable;
   * the reasoning is on `listLatestInCategory`, and the tags they carry are
   * chosen so ingest never purges them.
   *
   * In parallel because they are independent, so a cold render pays one round
   * trip rather than three.
   */
  const [latestResults, latestAdmitCards, openJobs] = await Promise.all([
    listLatestInCategory("result"),
    listLatestInCategory("admit_card"),
    jobRailSubject ? listOpenJobsMatching(jobRailSubject) : Promise.resolve([]),
  ]);

  // Composed in order of specificity: the siblings are about this exam, so
  // they keep any row the site-wide rails would also have shown.
  const taken = takenSlugs(slug, siblings);
  const resultRail = pickRailRows(latestResults, taken, 5);
  const admitCardRail = pickRailRows(latestAdmitCards, taken, 5);
  const jobRail = openJobs.slice(0, 4);

  const initials = toInitials(
    orgShort ?? orgName ?? update.exam?.short_name ?? update.exam?.name ?? "GOVT",
  );

  return (
    <article className="relative mx-auto max-w-3xl px-4 pt-6 pb-28 lg:px-6 lg:pb-12">
      {/* Emitted server-side so a crawler sees it in the initial HTML, and as
          one array for the same reason the job page does it. */}
      <script
        type="application/ld+json"
        // Built from typed database columns, not user input.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(
            [
              examUpdateJsonLd(update, env.NEXT_PUBLIC_SITE_URL),
              breadcrumbJsonLd(env.NEXT_PUBLIC_SITE_URL, [
                { name: "Exam updates", path: "/updates" },
                { name: title },
              ]),
              // Describes the rails below. Null when they are all empty, and
              // filtered out rather than serialised as `null` — a JSON-LD array
              // with a null member is invalid and costs the whole block.
              updateRailsJsonLd(
                [...siblings, ...resultRail, ...admitCardRail],
                env.NEXT_PUBLIC_SITE_URL,
              ),
            ].filter((entry) => entry !== null),
          ),
        }}
      />

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

      {/* The ask, placed after the reader has what they came for. Two anchors
          and no JavaScript — see `ShareRow`. */}
      <ShareRow slug={slug} title={title} />

      <TrackExamsCta term={term} />

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

      {/* Exit paths, in the order a reader of *this* page is most likely to
          want them. Results and admit cards are what the audience refreshes
          for; the job rail is the one route from a finished exam to one they
          can still apply to. */}
      <UpdateRail
        title="Latest results"
        href="/updates?category=result"
        linkLabel="All results"
        updates={resultRail}
      />
      <UpdateRail
        title="Latest admit cards"
        href="/updates?category=admit_card"
        linkLabel="All admit cards"
        updates={admitCardRail}
      />
      <JobRail
        title={jobRailSubject ? `Open ${jobRailSubject} vacancies` : "Open vacancies"}
        href="/jobs"
        linkLabel="All jobs"
        jobs={jobRail}
      />

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
