import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { getExamUpdateBySlug, listExamUpdateSlugs } from "@/lib/db/queries/exam-updates";
import { getJobById } from "@/lib/db/queries/jobs";
import { env } from "@/lib/env";
import { formatDate } from "@/lib/format/deadline";
import { CATEGORY_LABELS, CATEGORY_TONE } from "@/lib/updates/categories";

/**
 * One exam update.
 *
 * Statically generated per slug and revalidated by tag when ingest touches the
 * row — the same contract as a job page. Crawler traffic therefore costs a CDN
 * hit rather than a function invocation, which was cause #6 of the rebuild.
 */
export async function generateStaticParams() {
  const slugs = await listExamUpdateSlugs();
  return slugs.map(({ slug }) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const update = await getExamUpdateBySlug(slug);

  if (!update) return { title: "Update not found" };

  const description =
    update.summary ?? `${CATEGORY_LABELS[update.category]} update for ${update.title}.`;

  return {
    title: update.title,
    description,
    alternates: { canonical: `/updates/${slug}` },
    openGraph: {
      title: update.title,
      description,
      url: `${env.NEXT_PUBLIC_SITE_URL}/updates/${slug}`,
      type: "article",
      publishedTime: update.published_at ?? undefined,
    },
  };
}

interface Section {
  heading?: string;
  body?: string;
}

interface DownloadLink {
  label?: string;
  url?: string;
}

export default async function UpdatePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const update = await getExamUpdateBySlug(slug);

  if (!update) notFound();

  const category = update.category;
  const date = formatDate(update.published_date ?? update.published_at);

  // The link the old schema never populated. A foreign key now, so this is a
  // primary-key lookup rather than the title-similarity scan that cost ~44 kB
  // on every job page.
  const job = update.job_id ? await getJobById(update.job_id) : null;

  const sections = (update.detail?.sections ?? []) as Section[];
  const downloads = (update.detail?.download_links ?? []) as DownloadLink[];

  return (
    <article className="mx-auto max-w-2xl px-4 py-8 lg:px-6">
      <nav aria-label="Breadcrumb" className="text-xs text-ink-3">
        <Link href="/updates" className="hover:text-ink hover:underline">
          Updates
        </Link>
        {update.exam ? <> / {update.exam.short_name ?? update.exam.name}</> : null}
      </nav>

      <header className="mt-3">
        {update.organization ? (
          <p className="text-2xs font-medium tracking-wide text-ink-3 uppercase">
            {update.organization.short_name ?? update.organization.name}
          </p>
        ) : null}

        <h1 className="mt-1 text-2xl leading-tight font-semibold tracking-tight text-ink">
          {update.title}
        </h1>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge tone={CATEGORY_TONE[category]}>{CATEGORY_LABELS[category]}</Badge>
          {date ? <span className="text-xs text-ink-3">{date}</span> : null}
        </div>
      </header>

      {update.summary ? (
        <p className="mt-5 text-base leading-relaxed text-ink-2">{update.summary}</p>
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
          <p className="mt-1 text-sm font-semibold text-ink">{job.title}</p>
        </Link>
      ) : null}

      {update.detail?.body ? (
        <div className="mt-6 text-sm leading-relaxed whitespace-pre-line text-ink-2">
          {update.detail.body}
        </div>
      ) : null}

      {sections.length > 0 ? (
        <div className="mt-8 flex flex-col gap-6">
          {sections.map((section, i) => (
            <section key={section.heading ?? i}>
              {section.heading ? (
                <h2 className="text-base font-semibold text-ink">{section.heading}</h2>
              ) : null}
              {section.body ? (
                <p className="mt-1.5 text-sm leading-relaxed whitespace-pre-line text-ink-2">
                  {section.body}
                </p>
              ) : null}
            </section>
          ))}
        </div>
      ) : null}

      {downloads.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-base font-semibold text-ink">Downloads</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {downloads.map((link) =>
              link.url ? (
                <li key={link.url}>
                  <a
                    href={link.url}
                    // Untrusted scraped destinations: noopener stops the target
                    // reaching back through window.opener, noreferrer withholds
                    // this site's URL from whoever is on the other end.
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="text-sm font-medium text-accent hover:underline"
                  >
                    {link.label ?? link.url}
                  </a>
                </li>
              ) : null,
            )}
          </ul>
        </section>
      ) : null}

      <footer className="mt-10 border-t border-line pt-4">
        <a
          href={update.source_url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="text-xs text-ink-3 hover:text-ink hover:underline"
        >
          Source
        </a>
      </footer>
    </article>
  );
}
