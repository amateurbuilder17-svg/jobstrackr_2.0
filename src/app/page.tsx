import Link from "next/link";
import { Suspense } from "react";

import { HomeSection, Rail, RailItem, RowList } from "@/components/jobs/rail";
import { DeadlineBadge } from "@/components/jobs/deadline-badge";
import { JobCard, JobCardSkeleton } from "@/components/jobs/job-card";
import { UpdateCard } from "@/components/updates/update-card";
import { Badge } from "@/components/ui/badge";
import { CardInteractive } from "@/components/ui/card";
import { UsersIcon } from "@/components/icons";
import { getUser } from "@/lib/auth/session";
import { listExamAttempts } from "@/lib/db/queries/attempts";
import { listPopularExams } from "@/lib/db/queries/exams";
import { listExamUpdates } from "@/lib/db/queries/exam-updates";
import { listHighestVacancy, listJobs } from "@/lib/db/queries/jobs";
import { listMatchedJobs } from "@/lib/db/queries/match";
import { formatCount, formatDate, formatVacancies } from "@/lib/format/deadline";
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
    <div className="mx-auto max-w-3xl px-4 py-8 lg:px-6 lg:py-10">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight text-ink lg:text-4xl">
          Every government job, without the noise
        </h1>
        <p className="mt-3 max-w-prose text-ink-2">
          Notifications, deadlines and eligibility for Indian competitive exams — checked daily,
          and only the ones you can actually apply for.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {/* Links, not buttons. The previous version rendered these as
              `<Button>` elements with no handler and no href: the two most
              prominent controls on the site navigated nowhere. */}
          <Link
            href="/jobs"
            className={
              "inline-flex h-11 items-center rounded-lg bg-accent px-5 text-base font-medium " +
              "text-on-accent transition-colors duration-(--duration-fast) hover:bg-accent-hover"
            }
          >
            Browse all jobs
          </Link>
          <Link
            href="/for-you"
            className={
              "inline-flex h-11 items-center rounded-lg border border-line bg-surface px-5 " +
              "text-base font-medium text-ink transition-colors duration-(--duration-fast) " +
              "hover:border-line-strong hover:bg-surface-2"
            }
          >
            Check my eligibility
          </Link>
        </div>
      </section>

      <div className="mt-12">
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
      </div>
    </div>
  );
}

/* ── Public rows ─────────────────────────────────────────────────────────── */

async function ClosingSoon() {
  const page = await listJobs({ sort: "closing", limit: 6 });
  if (page.items.length === 0) return null;

  return (
    <HomeSection title="Closing soon" href="/jobs">
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

async function JustPublished() {
  const page = await listJobs({ sort: "newest", limit: 6 });
  if (page.items.length === 0) return null;

  return (
    <HomeSection title="Just published" href="/jobs?sort=newest">
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
    <HomeSection title="Biggest recruitments" href="/jobs">
      <Rail>
        {jobs.map((job) => (
          <RailItem key={job.id}>
            <CardInteractive className="flex h-full flex-col p-4">
              <p className="cond text-2xs font-medium tracking-wide text-ink-3 uppercase">
                {job.organization?.short_name ?? job.organization?.name}
              </p>
              <h3 className="mt-1 line-clamp-3 flex-1 text-sm leading-snug font-semibold text-ink">
                <Link href={`/jobs/${job.slug}`} className="after:absolute after:inset-0">
                  {job.title}
                </Link>
              </h3>
              <p className="tabular mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-ink-2">
                <UsersIcon className="size-3.5 text-ink-3" />
                {formatVacancies(job.vacancies_display, job.vacancies) ??
                  formatCount(job.vacancies)}
              </p>
              <div className="mt-2">
                <DeadlineBadge date={job.last_date} />
              </div>
            </CardInteractive>
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
    <HomeSection title="Latest exam updates" href="/updates">
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
    <HomeSection title="Most tracked exams" href="/calendar" linkLabel="Calendar">
      <Rail>
        {exams.map((exam) => (
          <RailItem key={exam.id}>
            <CardInteractive className="flex h-full flex-col p-4">
              <h3 className="line-clamp-2 text-sm leading-snug font-semibold text-ink">
                <Link
                  href={`/updates?exam=${exam.slug}`}
                  className="after:absolute after:inset-0"
                >
                  {exam.short_name ?? exam.name}
                </Link>
              </h3>
              {exam.next_event_label ? (
                <p className="mt-1 line-clamp-1 text-xs text-ink-2">{exam.next_event_label}</p>
              ) : null}
              <p className="tabular mt-auto pt-3 text-xs text-ink-3">
                {formatCount(exam.tracked)} tracking
                {exam.next_event_at ? ` · ${formatDate(exam.next_event_at) ?? ""}` : ""}
              </p>
            </CardInteractive>
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
        <HomeSection title="Your exams" href="/tracker" linkLabel="My exams">
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
        <HomeSection title="Matched to your profile" href="/for-you" linkLabel="For You">
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

function RowsSkeleton({ title }: { title: string }) {
  return (
    <section className="mt-10 first:mt-0" aria-busy="true">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <div className="mt-3 overflow-hidden rounded-lg border border-line border-b-0">
        {Array.from({ length: 4 }, (_, i) => (
          <JobCardSkeleton key={i} />
        ))}
      </div>
    </section>
  );
}
