import { Suspense } from "react";
import { GuestCta } from "@/components/home/guest-cta";
import {
  HomeEmptySearchResults,
  HomeSearchBar,
  HomeSearchProvider,
} from "@/components/home/home-search-context";
import {
  ClosingSoonFeed,
  JustPublishedFeed,
  LatestUpdatesFeed,
  MatchedForYouFeed,
  PopularExamsFeed,
  TrackedExamsFeed,
} from "@/components/home/home-sections";
import {
  ClosingSoonSkeleton,
  JustPublishedSkeleton,
  LatestUpdatesSkeleton,
  MatchedForYouSkeleton,
  PopularExamsSkeleton,
  TrackedExamsSkeleton,
} from "@/components/home/skeletons";
import { AppSplash } from "@/components/splash/app-splash";
import { getUser } from "@/lib/auth/session";
import { listExamAttempts } from "@/lib/db/queries/attempts";
import { listPopularExams } from "@/lib/db/queries/exams";
import { listExamUpdates } from "@/lib/db/queries/exam-updates";
import { listJobs } from "@/lib/db/queries/jobs";
import { listMatchedJobs } from "@/lib/db/queries/match";

export const metadata = {
  title: "Jobstrackr — Track Indian Government Exams & Jobs",
  description:
    "Track Indian government jobs and competitive exams in one place. See deadlines, admit cards, exam progress and what to do next.",
};

/**
 * Home page with progressive loading.
 *
 * The search bar and static page container paint immediately on first frame.
 * Each data-driven section streams in concurrently via independent Suspense
 * boundaries with tailored skeleton fallbacks matching exact card dimensions
 * to eliminate cumulative layout shift (CLS = 0).
 */
export default function Home() {
  return (
    <>
      {/* The launch splash. Rendered here rather than in the shell because
          this is the route a cold open lands on — and because the shell is
          carried by all 694 static pages, where 1.4 kB of overlay markup on a
          job detail page buys nothing. It costs no JavaScript on any route:
          see `AppSplash`. */}
      <AppSplash />

      <div className="mx-auto w-full max-w-md space-y-6 px-4 pt-4 pb-28 sm:max-w-2xl sm:space-y-7 lg:max-w-4xl">
        <HomeSearchProvider>
          <HomeSearchBar />

          {/* 1. Tracked Exams (Personal dynamic row) */}
          <Suspense fallback={<TrackedExamsSkeleton />}>
            <TrackedExamsSection />
          </Suspense>

          {/* 2. Matched to your profile (Personal, signed-in only) */}
          <Suspense fallback={<MatchedForYouSkeleton />}>
            <MatchedForYouSection />
          </Suspense>

          {/* 3. Closing Soon (Lead spotlight) */}
          <Suspense fallback={<ClosingSoonSkeleton />}>
            <ClosingSoonSection />
          </Suspense>

          {/* 4. Just Published */}
          <Suspense fallback={<JustPublishedSkeleton />}>
            <JustPublishedSection />
          </Suspense>

          {/* 5. Popular Exams */}
          <Suspense fallback={<PopularExamsSkeleton />}>
            <PopularExamsSection />
          </Suspense>

          {/* 6. Latest Updates */}
          <Suspense fallback={<LatestUpdatesSkeleton />}>
            <LatestUpdatesSection />
          </Suspense>

          {/* Dynamic Empty Search Results (when searching/filtering) */}
          <HomeEmptySearchResults />

          {/* 7. Guest sign-up CTA for visitors */}
          <Suspense fallback={null}>
            <SignedOutOnly />
          </Suspense>
        </HomeSearchProvider>
      </div>
    </>
  );
}

/* ── Section Server Components ───────────────────────────────────────────── */

async function TrackedExamsSection() {
  const user = await getUser();
  if (!user) return null;

  const attempts = await listExamAttempts();
  if (attempts.length === 0) return null;

  return <TrackedExamsFeed attempts={attempts} />;
}

/**
 * Openings this reader meets every stated requirement for.
 *
 * One RPC (`match_jobs`) capped at three rows, and only for a signed-in reader
 * — `getUser()` is `cache()`d, so sharing it with `TrackedExamsSection` costs a
 * function call rather than a second round trip, and a guest pays for neither.
 *
 * The cap is the point: the full ranked feed is /for-you, and this row exists
 * to say "there are matches" and hand the reader the link. `match_jobs` returns
 * nothing at all when the profile is missing an age or a qualification, so an
 * incomplete profile silently drops the section rather than asking a second
 * query whether it should have run.
 */
async function MatchedForYouSection() {
  const user = await getUser();
  if (!user) return null;

  const jobs = await listMatchedJobs(3);
  if (jobs.length === 0) return null;

  return <MatchedForYouFeed jobs={jobs} />;
}

async function ClosingSoonSection() {
  const page = await listJobs({ sort: "closing", limit: 6 });
  if (page.items.length === 0) return null;

  return <ClosingSoonFeed jobs={page.items} />;
}

async function JustPublishedSection() {
  const page = await listJobs({ sort: "newest", limit: 6 });
  if (page.items.length === 0) return null;

  return <JustPublishedFeed jobs={page.items} />;
}

async function PopularExamsSection() {
  const exams = await listPopularExams(10);
  if (exams.length === 0) return null;

  return <PopularExamsFeed exams={exams} />;
}

async function LatestUpdatesSection() {
  const page = await listExamUpdates({ limit: 4 });
  if (page.items.length === 0) return null;

  return <LatestUpdatesFeed updates={page.items} />;
}

async function SignedOutOnly() {
  const user = await getUser();
  if (user) return null;
  return <GuestCta />;
}
