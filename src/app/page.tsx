import Link from "next/link";
import { Suspense } from "react";

import { HomeSection, Rail, RailItem, RowList } from "@/components/jobs/rail";
import { JobCard, JobCardSkeleton } from "@/components/jobs/job-card";
import { ExamTile } from "@/components/home/exam-tile";
import { GuestCta } from "@/components/home/guest-cta";
import { Hero } from "@/components/home/hero";
import { QuickLinks } from "@/components/home/quick-links";
import { Spotlight } from "@/components/home/spotlight";
import { VacancyCard } from "@/components/home/vacancy-card";
import { UpdateCard } from "@/components/updates/update-card";
import { Badge } from "@/components/ui/badge";
import { CardInteractive } from "@/components/ui/card";
import { getUser } from "@/lib/auth/session";
import { listExamAttempts } from "@/lib/db/queries/attempts";
import { listPopularExams } from "@/lib/db/queries/exams";
import { listExamUpdates } from "@/lib/db/queries/exam-updates";
import { listHighestVacancy, listJobs } from "@/lib/db/queries/jobs";
import { listMatchedJobs } from "@/lib/db/queries/match";
import { formatDate } from "@/lib/format/deadline";
import { STATUS_LABELS, STATUS_TONE, type AttemptStatus } from "@/lib/tracker/enums";

export const metadata = { title: "Government jobs and exam updates" };

/**
 * Home.
 *
 * Five public rows and two personal ones, and the split between them is the
 * whole architecture in one page.
 *
 * The five public rows are prerendered and served from the CDN to every
 * visitor and every crawler — no cookies are read to produce them, so nothing
 * about this page forces a per-request render. The two personal rows are
 * dynamic by definition, and they sit inside their own Suspense boundaries so
 * the static half paints immediately and the personal half streams in behind
 * it. A signed-out visitor never pays for the personal half at all.
 *
 * The hero and the quick links are deliberately data-free. They are the first
 * thing painted and the last thing that should ever wait on a query, so they
 * are pure markup inside the static shell — a homepage whose first screen is a
 * skeleton has failed at the only job the first screen has.
 *
 * ── Against the old home page ─────────────────────────────────────────────
 * The old one downloaded every job in the database — a multi-megabyte bundle —
 * and then computed its rows in the browser: highest vacancy by sorting the
 * lot, "new jobs" by filtering the lot, recommendation shelves by scoring the
 * lot. It also branched four ways on how complete the reader's profile was,
 * producing a different page for new users, guests, and people with tracked
 * exams, which is why it could never be reasoned about.
 *
 * Here every row is one bounded, indexed, tagged query, and there is one page.
 * Signing in adds rows; it does not replace them.
 */
export default function Home() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 lg:px-6 lg:py-8">
      <Hero />
      <QuickLinks />

      <div className="mt-14">
        {/* Personal rows first when there are any: someone signed in came back
            for their own deadlines, not to browse. They render nothing at all
            for a guest, so the public rows move up rather than sitting under a
            gap. */}
        <Suspense fallback={null}>
          <PersonalRows />
        </Suspense>

        <Suspense fallback={<RowsSkeleton title="Closing soon" />}>
          <ClosingSoon />
        </Suspense>

        <Suspense fallback={<RowsSkeleton title="Just published" />}>
          <JustPublished />
        </Suspense>

        <Suspense fallback={null}>
          <HighestVacancy />
        </Suspense>

        <Suspense fallback={null}>
          <LatestUpdates />
        </Suspense>

        <Suspense fallback={null}>
          <PopularExams />
        </Suspense>

        {/* Last, and only for guests — see the note in `guest-cta.tsx` on why
            this is the foot of the page rather than the head of it. */}
        <Suspense fallback={null}>
          <SignedOutOnly />
        </Suspense>
      </div>
    </div>
  );
}

/* ── Public rows ─────────────────────────────────────────────────────────── */

/**
 * The most urgent open job, then the next five.
 *
 * One query, two treatments. Six rows of equal weight make the reader redo the
 * ranking the sort already did, so the first row is promoted to a spotlight and
 * the remainder stay a table — which is the shape a list of deadlines should
 * have once the reader knows where the top of it is.
 */
async function ClosingSoon() {
  const page = await listJobs({ sort: "closing", limit: 6 });
  const [lead, ...rest] = page.items;
  if (!lead) return null;

  return (
    <HomeSection
      title="Closing soon"
      subtitle="Application windows shutting first"
      href="/jobs"
    >
      <Spotlight job={lead} />

      {rest.length > 0 ? (
        <div className="mt-3">
          <RowList>
            {rest.map((job) => (
              <li key={job.id}>
                <JobCard job={job} />
              </li>
            ))}
          </RowList>
        </div>
      ) : null}
    </HomeSection>
  );
}

async function JustPublished() {
  const page = await listJobs({ sort: "newest", limit: 6 });
  if (page.items.length === 0) return null;

  return (
    <HomeSection
      title="Just published"
      subtitle="Added since yesterday's check"
      href="/jobs?sort=newest"
    >
      <RowList>
        {page.items.map((job) => (
          <li key={job.id}>
            <JobCard job={job} />
          </li>
        ))}
      </RowList>
    </HomeSection>
  );
}

async function HighestVacancy() {
  const jobs = await listHighestVacancy(8);
  if (jobs.length === 0) return null;

  return (
    <HomeSection title="Biggest recruitments" subtitle="Most posts on offer" href="/jobs">
      <Rail>
        {jobs.map((job) => (
          <RailItem key={job.id}>
            <VacancyCard job={job} />
          </RailItem>
        ))}
      </Rail>
    </HomeSection>
  );
}

async function LatestUpdates() {
  const page = await listExamUpdates({ limit: 4 });
  if (page.items.length === 0) return null;

  return (
    <HomeSection
      title="Latest exam updates"
      subtitle="Admit cards, answer keys and results"
      href="/updates"
    >
      <ul className="flex flex-col gap-3">
        {page.items.map((update) => (
          <li key={update.id}>
            <UpdateCard update={update} />
          </li>
        ))}
      </ul>
    </HomeSection>
  );
}

async function PopularExams() {
  const exams = await listPopularExams(10);
  // Nothing tracked yet means no ranking exists. The row disappears rather
  // than inventing one — see the note on `popular_exams` in migration 0021.
  if (exams.length === 0) return null;

  return (
    <HomeSection
      title="Most tracked exams"
      subtitle="What other candidates are following"
      href="/calendar"
      linkLabel="Calendar"
    >
      <Rail>
        {exams.map((exam) => (
          <RailItem key={exam.id}>
            <ExamTile exam={exam} />
          </RailItem>
        ))}
      </Rail>
    </HomeSection>
  );
}

/* ── Personal rows ───────────────────────────────────────────────────────── */

/**
 * The two dynamic reads on this page, and the only ones.
 *
 * Guarded by a single `getUser()` so a signed-out visitor costs one cookie
 * check and no queries at all — rather than two queries that return empty and
 * a page that has become dynamic for nobody's benefit.
 */
async function PersonalRows() {
  const user = await getUser();
  if (!user) return null;

  const [attempts, matches] = await Promise.all([listExamAttempts(), listMatchedJobs(3)]);

  return (
    <>
      {attempts.length > 0 ? (
        <HomeSection
          title="Your exams"
          subtitle="Everything you are tracking"
          href="/tracker"
          linkLabel="My exams"
        >
          <Rail>
            {attempts.slice(0, 8).map((attempt) => {
              const status = attempt.status as AttemptStatus;
              const name =
                attempt.exam?.name ??
                attempt.custom_name ??
                attempt.job?.title ??
                "Tracked exam";
              const href = attempt.job ? `/jobs/${attempt.job.slug}` : "/tracker";
              return (
                <RailItem key={attempt.id}>
                  <CardInteractive className="flex h-full flex-col p-4">
                    <h3 className="line-clamp-2 text-sm leading-snug font-semibold text-ink">
                      <Link href={href} className="after:absolute after:inset-0">
                        {name}
                      </Link>
                    </h3>
                    <p className="tabular mt-2 text-xs text-ink-3">
                      {formatDate(attempt.exam_date) ?? "No date yet"}
                    </p>
                    <div className="mt-auto pt-3">
                      <Badge tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</Badge>
                    </div>
                  </CardInteractive>
                </RailItem>
              );
            })}
          </Rail>
        </HomeSection>
      ) : null}

      {matches.length > 0 ? (
        <HomeSection
          title="Matched to your profile"
          subtitle="Age, qualification and stream all check out"
          href="/for-you"
          linkLabel="For You"
        >
          <RowList>
            {matches.map((job) => (
              <li key={job.id}>
                <JobCard job={job} />
              </li>
            ))}
          </RowList>
        </HomeSection>
      ) : null}
    </>
  );
}

/**
 * The guest sign-up prompt.
 *
 * A separate component from `PersonalRows` only because it belongs at the other
 * end of the page. It shares that component's `getUser()` — React caches it per
 * request — so the second boundary costs a function call, not a round trip.
 */
async function SignedOutOnly() {
  const user = await getUser();
  if (user) return null;
  return <GuestCta />;
}

function RowsSkeleton({ title }: { title: string }) {
  return (
    <section className="mt-12 first:mt-0" aria-busy="true">
      {/* Matches the real header's rule and spacing, so the section does not
          jump when the query resolves. */}
      <div className="flex items-end justify-between gap-4 border-b border-line pb-2.5">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
          <span aria-hidden className="h-4 w-[3px] shrink-0 rounded-full bg-accent" />
          {title}
        </h2>
      </div>
      <div className="mt-4 overflow-hidden rounded-lg border border-line border-b-0">
        {Array.from({ length: 4 }, (_, i) => (
          <JobCardSkeleton key={i} />
        ))}
      </div>
    </section>
  );
}
