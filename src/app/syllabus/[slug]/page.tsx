import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ExternalLinkIcon, SearchIcon, ShieldCheckIcon } from "@/components/icons";
import { toInitials } from "@/components/home/monogram";
import { getSyllabusBySlug } from "@/lib/db/queries/syllabus";
import { SyllabusActions } from "./syllabus-actions";
import { SyllabusView } from "./syllabus-view";

/**
 * One exam's syllabus detail.
 *
 * Everything here is a Server Component with Cache Components `"use cache"`.
 * Styled to match the app's Gazette theme:
 * - Editorial header with squircle monogram emblem.
 * - Official verified badges.
 * - Stage overview headers with brand accents.
 * - Subject cards with emerald topic bullets and weightage tags.
 * - Rounded-2xl source document list.
 */
export const instant = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const cached = await getSyllabusBySlug(slug);
  if (!cached) return { title: "Syllabus not found" };

  const { examName, year } = cached.syllabus;
  const subjects = cached.syllabus.stages
    .flatMap((s) => s.sections.map((x) => x.subject))
    .filter(Boolean)
    .slice(0, 4)
    .join(", ");

  return {
    title: `${examName} syllabus`,
    description: subjects
      ? `Official ${examName}${year ? ` ${String(year)}` : ""} syllabus — ${subjects}, with marks and exam pattern.`
      : `Official ${examName} syllabus, subject by subject.`,
    alternates: { canonical: `/syllabus/${slug}` },
  };
}

export default function SyllabusDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:py-10">
      <Suspense fallback={<SyllabusSkeleton />}>
        <SyllabusBody params={params} />
      </Suspense>
    </div>
  );
}

async function SyllabusBody({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const cached = await getSyllabusBySlug(slug);

  if (!cached) notFound();

  const { syllabus, grounded, fetchedAt } = cached;
  const multiStage = syllabus.stages.length > 1;
  const initials = toInitials(syllabus.examName);

  return (
    <>
      {/* Top back navigation, with the old result screen's two actions */}
      <div className="flex items-center justify-between gap-3 pb-4">
        <Link
          href="/syllabus"
          className="inline-flex items-center gap-2 text-sm font-semibold text-ink transition-colors hover:text-ink-2"
        >
          <span className="text-base font-bold" aria-hidden="true">
            ←
          </span>
          <span>Syllabus finder</span>
        </Link>
        <SyllabusActions syllabus={syllabus} slug={slug} />
      </div>

      {/* Hero Header */}
      <header className="mt-2 flex items-start gap-3.5 sm:gap-4">
        {/* Squircle Emblem */}
        <div
          className="relative flex size-14 sm:size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-line/70 bg-logo-plate p-1.5 shadow-xs"
          aria-hidden="true"
        >
          <span className="cond select-none text-base sm:text-lg font-extrabold tracking-wider text-ink-2">
            {initials}
          </span>
        </div>

        {/* Title & Badges */}
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-extrabold tracking-tight text-ink leading-tight">
            {syllabus.examName} <span className="text-brand">Syllabus</span>
          </h1>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {syllabus.year ? (
              <span className="inline-flex items-center rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-ink-2">
                {syllabus.year}
              </span>
            ) : null}
            {multiStage ? (
              <span className="inline-flex items-center rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-ink-2">
                {syllabus.stages.length} stages
              </span>
            ) : null}
            {grounded ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-good/25 bg-good-soft px-2.5 py-0.5 text-xs font-medium text-good">
                <ShieldCheckIcon className="size-3.5 shrink-0" aria-hidden="true" />
                <span>Official Source Verified</span>
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border border-warn/25 bg-warn-soft px-2.5 py-0.5 text-xs font-medium text-warn">
                Not searched — from memory
              </span>
            )}
          </div>
        </div>
      </header>

      {/* Verification Notice Card */}
      <div className="mt-6 flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-xs sm:text-sm leading-relaxed text-ink-2 shadow-xs">
        <ShieldCheckIcon className="size-4.5 text-brand shrink-0 mt-0.5" aria-hidden="true" />
        <p>
          Extracted directly from recruiting body notifications. Always confirm against the
          latest official notification before planning your preparation — a syllabus is subject
          to board revisions. Fetched{" "}
          <time dateTime={fetchedAt} className="font-semibold text-ink">
            {formatWhen(fetchedAt)}
          </time>
          .
        </p>
      </div>

      {/* Stage tabs, pattern stats, weightage and topics */}
      <SyllabusView syllabus={syllabus} />

      {/* Official Sources Card */}
      {syllabus.sources.length > 0 ? (
        <section className="mt-10">
          <div className="mb-3 flex items-center gap-2.5">
            <span className="h-4.5 w-1 shrink-0 rounded-full bg-brand" aria-hidden="true" />
            <h2 className="text-base sm:text-lg font-bold tracking-tight text-ink">
              Official Sources
            </h2>
          </div>
          <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-xs divide-y divide-line">
            {syllabus.sources.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="flex items-center justify-between gap-3 px-4 py-3 text-xs sm:text-sm text-ink transition-colors hover:bg-surface-2"
              >
                {/*
                  The host, not the address. Two of these come back wrapped in
                  a `vertexaisearch.cloud.google.com/grounding-api-redirect/…`
                  link whenever the search pass does not name its sources in
                  prose, and those run past two hundred characters of base64 —
                  which truncates to an ellipsis that says nothing at all. The
                  host is the part a reader is actually checking, and the print
                  sheet has always shown it this way.
                */}
                <span className="truncate min-w-0 font-medium text-brand hover:underline">
                  {sourceHost(url)}
                </span>
                <ExternalLinkIcon className="size-4 shrink-0 text-ink-3" />
              </a>
            ))}
          </div>
        </section>
      ) : null}

      {/* Search Another Exam Action */}
      <div className="mt-10 pt-6 border-t border-line">
        <Link
          href="/syllabus"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-line bg-surface px-5 text-sm font-semibold text-ink shadow-xs transition-colors hover:bg-surface-2 hover:border-line-strong"
        >
          <SearchIcon className="size-4 text-brand" />
          <span>Search another exam</span>
        </Link>
      </div>
    </>
  );
}

function SyllabusSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      <div className="h-4 w-36 rounded-md skeleton" />
      <div className="flex items-start gap-4">
        <div className="size-16 rounded-2xl skeleton shrink-0" />
        <div className="flex-1 space-y-2">
          <div className="h-7 w-3/4 rounded-md skeleton" />
          <div className="h-4 w-1/3 rounded-md skeleton" />
        </div>
      </div>
      <div className="h-16 rounded-2xl border border-line bg-surface skeleton" />
      <div className="mt-4 flex flex-col gap-4">
        {[0, 1].map((i) => (
          <div key={i} className="h-36 rounded-2xl border border-line bg-surface skeleton" />
        ))}
      </div>
    </div>
  );
}

function formatWhen(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return "recently";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${String(days)} days ago`;
}

/**
 * The part of a source address worth showing: its host.
 *
 * `ssc.gov.in` rather than `https://ssc.gov.in/notice/2026/...`, which is what
 * the reader is checking — did this come from the conducting body — and it is
 * the only part of a grounding redirect that fits on the line at all. The
 * `www.` goes too, since it distinguishes nothing.
 *
 * Falls back to the whole string rather than dropping the row: an address this
 * cannot parse is still a link somebody may want to follow, and the `href`
 * beside this is unaffected either way.
 */
function sourceHost(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./i, "");
  } catch {
    return url;
  }
}
