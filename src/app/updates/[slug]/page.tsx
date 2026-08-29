import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Details,
  ImportantDates,
  LinkList,
  Overview,
  Section,
} from "@/components/updates/detail-sections";
import { Badge } from "@/components/ui/badge";
import { FreshDot } from "@/components/updates/fresh-dot";
import { UpdateCard } from "@/components/updates/update-card";
import {
  getExamUpdateBySlug,
  listExamUpdateSlugsForBuild,
  listRelatedUpdates,
} from "@/lib/db/queries/exam-updates";
import { getJobById } from "@/lib/db/queries/jobs";
import { env } from "@/lib/env";
import { formatDate, formatDeadlineText, formatVacancies } from "@/lib/format/deadline";
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
 * One exam update.
 *
 * Statically generated per slug and revalidated by tag when ingest touches the
 * row — the same contract as a job page. Crawler traffic therefore costs a CDN
 * hit rather than a function invocation, which was cause #6 of the rebuild.
 *
 * ── What this page owes the reader ────────────────────────────────────────
 * It used to print `detail.body` — a 3 kB flattened dump of the whole source
 * page, adverts included — and then a list of `section.heading`s with nothing
 * under them, because it read `section.body` on rows that store
 * `section.content` as an array. `overview`, `important_dates` and
 * `related_articles` were fetched by the query and rendered nowhere. So the two
 * things a reader opens an admit-card page for — the download window and the
 * download button — were the two things absent, and the aggregator's "Join our
 * WhatsApp channel" was present.
 *
 * This restores the old app's layout, which had the running order right:
 * the action first, then the dates, then the facts table, then the article,
 * then every link. `lib/updates/detail-shape.ts` does the cleaning, so what
 * follows is display.
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

  // The link the old schema never populated. A foreign key now, so this is a
  // primary-key lookup rather than the title-similarity scan that cost ~44 kB
  // on every job page.
  const job = update.job_id ? await getJobById(update.job_id) : null;

  const detail = update.detail;
  // Rows in the date table that turned out to be "Click here" links carry URLs
  // that appear nowhere else on ~10 of every 16 such updates, so they are
  // rescued into the links list rather than dropped with the row.
  const { dates: tableDates, links: harvested } = partitionUpdateDates(detail?.important_dates);

  // The dates table is empty on 1,515 of the 5,374 stored rows, and on 1,006 of
  // those the dates are simply in a different column — see `datesFromOverview`.
  // Both helpers move rather than copy, so what is promoted here is what the
  // "At a glance" table and the accordion below no longer show.
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

  // The way out of this page. With `exam_id` NULL on every row there is no key
  // to join on, so this relates on the organisation the title leads with —
  // see `relationTerm`. A title with no usable term renders no section.
  const term = relationTerm(update.title);
  const siblings = term ? await listRelatedUpdates(term, slug) : [];

  return (
    <article className="mx-auto max-w-2xl px-4 py-8 lg:px-6">
      <nav aria-label="Breadcrumb" className="text-xs text-ink-3">
        <Link href="/updates" className="hover:text-ink hover:underline">
          Updates
        </Link>
        {update.exam ? <> / {update.exam.short_name ?? update.exam.name}</> : null}
      </nav>

      <header className="mt-3">
        {/* `organization_id` is NULL on all 5,374 rows, so this eyebrow was
            blank on every page. `term` is the acronym the title already leads
            with — the same one the related section is keyed on — so falling
            back to it restates the title rather than asserting anything new. */}
        {(update.organization ?? term) ? (
          <p className="text-2xs font-medium tracking-wide text-ink-3 uppercase">
            {update.organization
              ? (update.organization.short_name ?? update.organization.name)
              : term}
          </p>
        ) : null}

        <h1 className="mt-1 text-2xl leading-tight font-semibold tracking-tight text-ink">
          {title}
        </h1>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone={CATEGORY_TONE[category]}>{CATEGORY_LABELS[category]}</Badge>
          {date ? <span className="text-xs text-ink-3">Published {date}</span> : null}
          {/* The old header carried a "New" flash for the first 24 hours. This
              is the same fact, and it costs no query — see `FreshDot`. */}
          <FreshDot date={update.published_date ?? update.published_at} />
        </div>
      </header>

      {/* The reason the page was opened, at the top and thumb-sized. On an
          admit-card update this button *is* the content; everything below it
          explains the button. */}
      {action ? (
        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <a
            href={action.url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md bg-accent px-5 text-sm font-semibold text-white transition-opacity duration-(--duration-fast) hover:opacity-90"
          >
            {CATEGORY_CTA[category]}
          </a>
          {official ? (
            <a
              href={official.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md border border-line bg-surface px-5 text-sm font-medium text-ink transition-colors duration-(--duration-fast) hover:border-line-strong hover:bg-surface-2"
            >
              {official.label}
            </a>
          ) : null}
        </div>
      ) : null}

      {update.summary ? (
        <p className="mt-5 text-base leading-relaxed text-ink-2">
          {decodeEntities(update.summary)}
        </p>
      ) : null}

      {/* The related job, when ingest resolved one. Shown as a real card link
          rather than a bare slug — this is the most likely next click. */}
      {job ? (
        <Link
          href={`/jobs/${job.slug}`}
          className="mt-6 block rounded-lg border border-accent/30 bg-accent/5 p-4 transition-colors hover:border-accent/50 hover:bg-accent/10"
        >
          <p className="text-2xs font-medium tracking-wide text-accent uppercase">
            Related notification
          </p>
          <p className="mt-1 text-sm font-semibold text-ink">{decodeEntities(job.title)}</p>
          {/* The two facts that decide whether this link is worth following. */}
          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-2">
            {formatVacancies(job.vacancies_display, job.vacancies) ? (
              <span>{formatVacancies(job.vacancies_display, job.vacancies)}</span>
            ) : null}
            {formatDeadlineText(job.last_date_display, job.last_date) ? (
              <span>Apply by {formatDeadlineText(job.last_date_display, job.last_date)}</span>
            ) : null}
          </p>
        </Link>
      ) : null}

      <ImportantDates dates={dates} />
      <Overview rows={overview} />
      <Details sections={sections} />
      <LinkList title="Important links" links={links} />
      <LinkList title="Related articles" links={related} />

      {/* `detail.body` is deliberately not rendered. It is the whole source
          page flattened into one string — the same headings and lines the
          sections above already carry, plus the aggregator's advert blocks and
          its own tables run together as prose. It is kept in the column for
          re-parsing, not for reading. */}

      {siblings.length > 0 ? (
        <Section title={`More ${term ?? ""} updates`.replace(/\s+/g, " ")}>
          <ul className="flex flex-col gap-3">
            {siblings.map((sibling) => (
              <li key={sibling.id}>
                <UpdateCard update={sibling} />
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
                <Badge>{tag}</Badge>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <footer className="mt-10 border-t border-line pt-4 text-xs text-ink-3">
        {/* When this row was last read from the source. The old page carried
            the same line, and it is what tells a reader whether a date that
            has not moved is stale or simply unchanged. */}
        {checked ? <p>Last checked {checked}.</p> : null}
        <p>Always check the official website before acting on a date or a link.</p>
        <a
          href={update.source_url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="mt-1 inline-block hover:text-ink hover:underline"
        >
          Source
        </a>
      </footer>
    </article>
  );
}
