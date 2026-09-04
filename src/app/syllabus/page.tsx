import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { BrandMark } from "@/components/brand/artwork";
import { BookOpenIcon, ChevronRightIcon } from "@/components/icons";
import { listOpenJobTitles } from "@/lib/db/queries/jobs";
import { listSyllabusSlugs } from "@/lib/db/queries/syllabus";
import { syllabusSlug } from "@/lib/syllabus/key";
import { POPULAR_EXAMS } from "./popular";
import { SyllabusSearchForm } from "./search-form";
import { buildSuggestions } from "./suggestions";

export const metadata: Metadata = {
  title: "Syllabus finder",
  description:
    "Search the official syllabus for any Indian government exam — subjects, topics, marks and stage-by-stage pattern.",
  alternates: { canonical: "/syllabus" },
};

/**
 * The ceiling on `searchSyllabusAction`, which is why it is declared here.
 *
 * A Server Action has no route config of its own — it runs inside the function
 * of the page it was posted from, and takes that page's `maxDuration`. Without
 * this line the search inherits the platform default, which on Vercel's Hobby
 * plan is ten seconds; the grounded call alone takes twenty to thirty. Every
 * search was therefore killed mid-flight in production, *after* claiming the
 * caller's daily quota and before anything could be written to the cache — a
 * feature that could not succeed once, and spent five searches a day proving
 * it. Locally it worked, because `next dev` enforces no such limit, which is
 * the reason it survived review.
 *
 * Sixty is the Hobby maximum. `lib/ai/syllabus.ts` budgets 52 seconds inside
 * it and leaves the rest for the cache write and the redirect.
 */
export const maxDuration = 60;

/** What `searchSyllabusAction` enforces. Stated here so the page can say it. */
const DAILY_LIMIT = 5;

/**
 * Syllabus search & directory page.
 *
 * The old app's `SyllabusCheck` screen, rebuilt on this app's Gazette theme:
 * search box with typeahead, Popular Exams tiles, and the exams already
 * fetched.
 *
 * One query serves the entire page. `listSyllabusSlugs` is `"use cache"` and
 * tagged, so it runs once per cache window for all visitors, and its rows feed
 * three things at once — the typeahead's suggestion pool, the "already
 * available" grid, and the Saved badges on the Popular tiles. The old screen
 * ran a separate select for the cached list on mount and two more per
 * keystroke; this one runs none while somebody types.
 */
export default function SyllabusPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:py-12">
      {/*
        Hero Header

        The mark sits beside the title the way the old app's header did — logo,
        then "SYLLABUS FINDER". `BrandMark` rather than an `<img>` so it follows
        the theme (navy on paper, white on dark) and fetches only the file the
        theme needs; and it costs nothing over the wire here, because the
        sidebar, top bar and footer have already requested the same asset.
      */}
      <div className="flex flex-col items-start">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <BrandMark className="w-8 sm:w-9" />
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold tracking-tight text-ink leading-tight">
            Syllabus Finder
          </h1>
        </div>
        <p className="mt-2 text-sm sm:text-base leading-relaxed text-ink-2">
          Search any Indian government exam to view its official syllabus — subjects, topics,
          marks, and stage-by-stage pattern extracted straight from recruiting body
          notifications.
        </p>
      </div>

      <Suspense
        fallback={
          <div className="mt-6 h-[7.5rem] rounded-2xl border border-line bg-surface skeleton" />
        }
      >
        <Finder />
      </Suspense>
    </div>
  );
}

/**
 * Everything below the hero, off one read.
 *
 * A single async component rather than two, because both halves want the same
 * rows and splitting them would either duplicate the query or thread the
 * result through a prop drill for no gain.
 */
async function Finder() {
  // In parallel, and both cached. Two round trips run as one wait, and on a
  // warm cache neither is a round trip at all.
  const [directory, jobs] = await Promise.all([listSyllabusSlugs(), listOpenJobTitles()]);

  /** Exams already fetched, for the Saved badge on the Popular tiles. */
  const cachedBySlug = new Map(directory.map((row) => [row.slug, row] as const));

  return (
    <>
      <SyllabusSearchForm suggestions={buildSuggestions(directory, jobs)} />

      {/*
        The daily ceiling, stated rather than counted down.

        The old screen kept a live "3 of 3 left" counter in localStorage, which
        made a promise it could not keep: the number was per-browser, so
        clearing site data reset it, and it was never the thing that actually
        refused a search. The real ceiling here is `claim_ai_quota`, which is
        atomic and per-account. Reading it to render this line would cost a
        query on every view of this page, for every visitor, most of whom are
        about to open something already cached. So the limit is stated as a
        fact and enforced where it is enforced; the counter appears in the
        refusal message, which is the moment it means anything.
      */}
      <p className="mt-3 text-xs text-ink-3">
        Already-fetched syllabi below open instantly. A new exam runs a live search of official
        sources — {DAILY_LIMIT} of those per account per day.
      </p>

      {/* Popular Exams */}
      <section className="mt-10">
        <div className="mb-1 flex items-center gap-2.5">
          <span className="h-4.5 w-1 shrink-0 rounded-full bg-brand" aria-hidden="true" />
          <h2 className="text-lg sm:text-xl font-bold tracking-tight text-ink">
            Popular Exams
          </h2>
        </div>
        <p className="text-xs sm:text-sm text-ink-3">
          The six most-searched recruitment exams in India.
        </p>

        <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
          {POPULAR_EXAMS.map((exam) => {
            // A popular exam that has already been fetched is a link to a
            // static page. One that has not is a search — the same submit the
            // box does, expressed as a link so it needs no JavaScript to work.
            const slug = syllabusSlug(exam.name);
            const cached = cachedBySlug.get(slug);
            const href = cached
              ? `/syllabus/${slug}`
              : `/syllabus?q=${encodeURIComponent(exam.name)}`;

            return (
              <Link
                key={exam.badge}
                href={href}
                className="group flex items-center gap-3 rounded-2xl border border-line bg-surface p-3.5 shadow-xs transition-all duration-200 hover:border-line-strong hover:bg-surface-2/60 hover:shadow-sm"
              >
                <div
                  className="flex size-11 shrink-0 items-center justify-center rounded-xl"
                  // The conducting body's own colour, tinted. See popular.ts.
                  style={{ backgroundColor: `${exam.color}1F`, color: exam.color }}
                  aria-hidden="true"
                >
                  <span className="cond text-xs font-extrabold tracking-wide">
                    {exam.badge}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-ink">{exam.name}</p>
                  <p className="truncate text-xs text-ink-3">
                    {cached ? "Saved · opens instantly" : exam.description}
                  </p>
                </div>
                <ChevronRightIcon className="size-4 shrink-0 text-ink-3 transition-all group-hover:translate-x-0.5 group-hover:text-ink" />
              </Link>
            );
          })}
        </div>
      </section>

      {/* Directory of Cached Syllabi */}
      {directory.length > 0 ? (
        <section className="mt-10">
          <div className="mb-1 flex items-center gap-2.5">
            <span className="h-4.5 w-1 shrink-0 rounded-full bg-brand" aria-hidden="true" />
            <h2 className="text-lg sm:text-xl font-bold tracking-tight text-ink">
              Available Syllabi
            </h2>
          </div>
          <p className="text-xs sm:text-sm text-ink-3">
            Open immediately with zero wait time — extracted from verified official
            notifications.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
            {directory.slice(0, 24).map((entry) => (
              <Link
                key={entry.slug}
                href={`/syllabus/${entry.slug}`}
                className="group flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3.5 shadow-xs transition-all duration-200 hover:border-line-strong hover:bg-surface-2/60 hover:shadow-sm"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand transition-colors dark:bg-brand-soft/20 group-hover:bg-brand group-hover:text-white">
                    <BookOpenIcon className="size-4.5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs sm:text-sm font-bold text-ink">
                      {entry.examName}
                    </p>
                    {entry.year === null ? null : (
                      <p className="text-xs text-ink-3 tabular">{entry.year}</p>
                    )}
                  </div>
                </div>
                <ChevronRightIcon className="size-4 shrink-0 text-ink-3 transition-all group-hover:translate-x-0.5 group-hover:text-ink" />
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}
