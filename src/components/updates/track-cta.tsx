import Link from "next/link";

import { ArrowRightIcon, BellIcon } from "@/components/icons";

/**
 * The re-engagement card at the foot of an update page.
 *
 * Search traffic to this route arrives for one fact — a result is out, an admit
 * card is downloadable — takes the fact, and leaves. That is the correct
 * behaviour for the reader and a dead end for the site, and the page previously
 * offered nothing else to do. This is the one ask, placed after the reader has
 * what they came for rather than in front of it.
 *
 * `/tracker` is `Disallow`ed in `robots.ts` and renders a sign-in card to a
 * signed-out visitor, both deliberately: it is a personalised surface with
 * nothing for a crawler to index. The link is still the right destination —
 * signing in *is* the conversion — and it is left `follow` because internal
 * `nofollow` has not sculpted PageRank for well over a decade, while robots.txt
 * does keep the crawler out. One link to a blocked path is a rounding error
 * against the several hundred followable ones this page now carries.
 *
 * `term` is the organisation acronym the title leads with, from `relationTerm`.
 * It is threaded through so the ask names what the reader was reading about;
 * when it is absent the sentence still stands on its own.
 */
export function TrackExamsCta({ term }: { term?: string | null }) {
  const subject = term?.trim();

  return (
    <section className="mt-12">
      <div className="rounded-2xl border border-accent-line bg-accent-soft/50 p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <span
            className="hidden size-11 shrink-0 items-center justify-center rounded-xl border border-accent-line bg-surface text-accent sm:flex"
            aria-hidden="true"
          >
            <BellIcon className="size-5" />
          </span>

          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold tracking-tight text-ink sm:text-lg">
              {subject
                ? `Never miss a ${subject} update again`
                : "Never miss an exam update again"}
            </h2>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-2">
              Track the exams you are preparing for and see admit cards, results and answer keys
              for all of them on one page — instead of checking a dozen official portals.
            </p>

            <Link
              href="/tracker"
              className={
                "group mt-4 inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 " +
                "bg-brand text-sm font-semibold text-white shadow-xs " +
                "transition-colors duration-(--duration-fast) hover:bg-brand-deep"
              }
            >
              <span>Track my exams</span>
              <ArrowRightIcon className="size-4 shrink-0 transition-transform duration-(--duration-fast) group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
