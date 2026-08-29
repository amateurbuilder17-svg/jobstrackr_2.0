import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ChevronRightIcon, ListIcon } from "@/components/icons";
import { listSyllabusSlugs } from "@/lib/db/queries/syllabus";
import { SyllabusSearchForm } from "./search-form";

export const metadata: Metadata = {
  title: "Syllabus finder",
  description:
    "Search the official syllabus for any Indian government exam — subjects, topics, marks and stage-by-stage pattern.",
  alternates: { canonical: "/syllabus" },
};

/**
 * Syllabus search.
 *
 * The page itself is static. The form posts to a Server Action, which does not
 * make the page holding it dynamic, and the two things that *would* — reading
 * `?q=` and reading the database — each sit behind their own `<Suspense>`, so
 * they stream into a prerendered shell instead of taking the route dynamic.
 */
export default function SyllabusPage() {
  return (
    <div className="mx-auto w-full max-w-[68ch] px-4 py-10 sm:px-6 lg:py-14">
      <h1 className="font-cond text-3xl font-bold tracking-tight text-balance text-ink">
        Syllabus finder
      </h1>
      <p className="mt-4 leading-relaxed text-ink-2">
        Search an exam and get its official syllabus — every subject, the topics under each,
        marks and duration, broken down stage by stage. Answers are read from the conducting
        body&rsquo;s own notification and the sources are shown with the result.
      </p>

      {/* The form reads `?q=` to survive a sign-in round trip, which makes it
          a reader of request data. Under Cache Components that has to sit
          behind a boundary or the whole route stops prerendering — the build
          fails on it rather than quietly serving a dynamic page. */}
      <Suspense
        fallback={<div className="mt-6 h-[7.5rem] rounded-md border border-line bg-surface" />}
      >
        <SyllabusSearchForm />
      </Suspense>

      <Suspense fallback={null}>
        <AlreadyFetched />
      </Suspense>
    </div>
  );
}

/**
 * Syllabi somebody has already paid for.
 *
 * Worth showing prominently: every one of these is instant and free, while a
 * name not on the list costs half a minute and one of the day's five searches.
 * Nudging people onto the cached path is the cheapest performance work
 * available.
 */
async function AlreadyFetched() {
  const rows = await listSyllabusSlugs();
  if (rows.length === 0) return null;

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold text-ink">Already available</h2>
      <p className="mt-1.5 text-sm text-ink-3">
        These open straight away — no waiting, and they do not use a search.
      </p>

      <ul className="mt-4 flex flex-col gap-0.5">
        {rows.slice(0, 12).map(({ slug }) => (
          <li key={slug}>
            <Link
              href={`/syllabus/${slug}`}
              className={
                "flex items-center gap-3 rounded-md px-3 py-2.5 " +
                "transition-colors duration-(--duration-fast) hover:bg-surface-2"
              }
            >
              <ListIcon className="size-[1.15rem] shrink-0 text-ink-3" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink uppercase">
                {slug.replaceAll("-", " ")}
              </span>
              <ChevronRightIcon className="size-4 shrink-0 text-ink-3" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
