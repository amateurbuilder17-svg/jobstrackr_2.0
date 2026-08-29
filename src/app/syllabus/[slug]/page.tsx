import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ExternalLinkIcon, SearchIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { getSyllabusBySlug } from "@/lib/db/queries/syllabus";
import type { SyllabusSection, SyllabusStage } from "@/lib/syllabus/schema";

/**
 * One exam's syllabus.
 *
 * Everything here is a Server Component: nine sections and a topic list for
 * every subject, and the browser pays nothing beyond the HTML. The page reads
 * through `publicDb` — no cookies — so it is cacheable and served from the CDN
 * to everybody after the first person paid for the model call.
 */

/**
 * This route does not prerender, and the reason is structural rather than lazy.
 *
 * The shell reads the URL — `NavLink` needs `usePathname()` to know which tab
 * is current, and that is not optional furniture. For a dynamic route whose
 * params are known at build time (`/jobs/[slug]`, via `generateStaticParams`)
 * every pathname is concrete and the shell prerenders happily. This corpus is
 * built at *runtime*: a slug exists because somebody searched for it five
 * minutes ago, so there is no list to enumerate, and Cache Components rejects a
 * `generateStaticParams` that returns nothing.
 *
 * That leaves three options. Wrapping the sidebar and bottom nav in `<Suspense>`
 * would fix it globally but makes the app's primary navigation stream on every
 * route, to pay for one. Seeding a placeholder row would put a fabricated
 * syllabus at a real URL. This is the third, and it is the escape hatch Next
 * documents for exactly this shape.
 *
 * What it costs: a function invocation per request instead of a CDN hit. What
 * it does *not* cost is a database read per request — `getSyllabusBySlug` is a
 * `"use cache"` scope keyed on the slug, so Supabase is touched once per
 * revalidation window however many people arrive. Crawlers get fully rendered
 * HTML either way.
 *
 * Revisit when the corpus stops growing: at that point `generateStaticParams`
 * over the cached slugs becomes viable and this line can go.
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

/**
 * The shell, which is static, and the body, which is not.
 *
 * There is deliberately no `generateStaticParams` here, and the reason is worth
 * writing down because the obvious fix is the wrong one. This corpus is built
 * at *runtime* — a slug exists because somebody searched for it five minutes
 * ago — so there is nothing to enumerate at build time, and Cache Components
 * rejects a `generateStaticParams` that returns an empty list outright.
 *
 * So `params` is read inside a `<Suspense>` boundary instead. The breadcrumb
 * and the frame prerender into a static shell; the syllabus streams into it.
 * And because `getSyllabusBySlug` is itself a `"use cache"` scope keyed on the
 * slug, the second visitor to any given exam is served from that cache rather
 * than from Postgres — which is the same economics as a prerender, arrived at
 * a different way.
 */
export default function SyllabusDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  return (
    <div className="mx-auto w-full max-w-[72ch] px-4 py-8 sm:px-6 lg:py-12">
      <Suspense fallback={<SyllabusSkeleton />}>
        <SyllabusBody params={params} />
      </Suspense>
    </div>
  );
}

async function SyllabusBody({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const cached = await getSyllabusBySlug(slug);

  // A miss here is a syllabus that was never fetched *or* one that expired.
  // Both are the same thing to a reader — it is not here — and both are fixed
  // the same way: search for it, which the 404 page offers.
  if (!cached) notFound();

  const { syllabus, grounded, fetchedAt } = cached;
  const multiStage = syllabus.stages.length > 1;

  return (
    <>
      <nav aria-label="Breadcrumb" className="text-xs text-ink-3">
        <Link href="/syllabus" className="hover:text-ink-2 hover:underline">
          Syllabus finder
        </Link>
        <span aria-hidden> / </span>
        <span className="text-ink-2">{syllabus.examName}</span>
      </nav>

      <h1 className="mt-3 font-cond text-3xl font-bold tracking-tight text-balance text-ink">
        {syllabus.examName}
        <span className="text-ink-3"> syllabus</span>
      </h1>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {syllabus.year ? <Badge>{syllabus.year}</Badge> : null}
        {multiStage ? <Badge>{syllabus.stages.length} stages</Badge> : null}
        {/* An ungrounded answer is the model recalling rather than reading, and
            for a document that gets revised that is a genuinely weaker claim.
            Labelled rather than hidden — and never presented as equivalent. */}
        {grounded ? null : <Badge tone="warn">Not searched — from memory</Badge>}
      </div>

      {/* The disclaimer is above the content, not buried under it. Somebody
          plans three months of study from this page; the one thing they must
          know is that it is a reading of the notification and not the
          notification. */}
      <p className="mt-5 rounded-md border border-line bg-surface-2 px-3.5 py-3 text-sm leading-relaxed text-ink-2">
        Read from official sources and checked for shape, not for truth. Confirm against the
        conducting body&rsquo;s current notification before you plan around it — a syllabus is
        revised, and this page was fetched{" "}
        <time dateTime={fetchedAt}>{formatWhen(fetchedAt)}</time>.
      </p>

      {syllabus.stages.map((stage, index) => (
        <Stage
          key={`${stage.name ?? "stage"}-${String(index)}`}
          stage={stage}
          showHeading={multiStage || Boolean(stage.name)}
        />
      ))}

      {syllabus.sources.length > 0 ? (
        <section className="mt-10 border-t border-line pt-6">
          <h2 className="text-lg font-semibold text-ink">Sources</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {syllabus.sources.map((url) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-start gap-1.5 text-sm text-accent underline underline-offset-2"
                >
                  <ExternalLinkIcon className="mt-0.5 size-3.5 shrink-0" />
                  <span className="break-all">{url}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-10 border-t border-line pt-6">
        <Link
          href="/syllabus"
          className="inline-flex items-center gap-2 text-sm font-medium text-accent hover:underline"
        >
          <SearchIcon className="size-4" />
          Search another exam
        </Link>
      </p>
    </>
  );
}

/**
 * What the static shell shows while the syllabus streams in.
 *
 * Sized to the real thing rather than being a spinner: a heading block and a
 * few section blocks, so the page does not jump when the content lands.
 */
function SyllabusSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      <div className="h-3 w-40 rounded bg-surface-2" />
      <div className="h-9 w-3/4 rounded bg-surface-2" />
      <div className="h-16 rounded-md border border-line bg-surface-2" />
      <div className="mt-4 flex flex-col gap-6">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="h-5 w-48 rounded bg-surface-2" />
            <div className="h-4 w-full rounded bg-surface-2" />
            <div className="h-4 w-5/6 rounded bg-surface-2" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Stage({ stage, showHeading }: { stage: SyllabusStage; showHeading: boolean }) {
  const meta = [
    stage.examType,
    stage.totalMarks === null ? null : `${String(stage.totalMarks)} marks`,
    stage.durationMins === null ? null : `${String(stage.durationMins)} min`,
  ].filter(Boolean);

  return (
    <section className="mt-9">
      {showHeading ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line pb-2">
          <h2 className="text-xl font-semibold text-ink">{stage.name ?? "Syllabus"}</h2>
          {meta.length > 0 ? (
            <span className="text-sm text-ink-3">{meta.join(" · ")}</span>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-col gap-6">
        {stage.sections.map((section, index) => (
          <SectionBlock
            key={`${section.subject ?? section.sectionTitle ?? "section"}-${String(index)}`}
            section={section}
          />
        ))}
      </div>
    </section>
  );
}

function SectionBlock({ section }: { section: SyllabusSection }) {
  const heading = section.subject ?? section.sectionTitle;
  const sub = section.subject && section.sectionTitle ? section.sectionTitle : null;
  const weight =
    section.marksWeightage ??
    (section.marks === null ? null : `${String(section.marks)} marks`);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-semibold text-ink">{heading ?? "Topics"}</h3>
        {weight ? <span className="text-sm text-ink-3">{weight}</span> : null}
      </div>
      {sub ? <p className="mt-0.5 text-sm text-ink-3">{sub}</p> : null}

      {/* Topics as a list, not as chips. A syllabus topic is a phrase — "Data
          interpretation and sufficiency" — and a wall of pill-shaped phrases at
          mixed widths is harder to read down than a plain list, which is what
          somebody does with this page. */}
      <ul className="mt-2 flex flex-col gap-1.5 pl-5">
        {section.topics.map((topic) => (
          <li key={topic} className="list-disc leading-relaxed text-ink-2 marker:text-ink-3">
            {topic}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "3 days ago" is the useful framing for a cached document, not a timestamp. */
function formatWhen(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days < 0) return "recently";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${String(days)} days ago`;
}
