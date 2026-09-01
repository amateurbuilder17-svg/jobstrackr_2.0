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
  PopularExamsFeed,
  TrackedExamsFeed,
} from "@/components/home/home-sections";
import {
  ClosingSoonSkeleton,
  JustPublishedSkeleton,
  LatestUpdatesSkeleton,
  PopularExamsSkeleton,
  TrackedExamsSkeleton,
} from "@/components/home/skeletons";
import { getUser } from "@/lib/auth/session";
import { listExamAttempts } from "@/lib/db/queries/attempts";
import { listPopularExams } from "@/lib/db/queries/exams";
import { listExamUpdates } from "@/lib/db/queries/exam-updates";
import { listJobs } from "@/lib/db/queries/jobs";

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
    <div className="mx-auto w-full max-w-md px-4 pt-4 pb-28 sm:max-w-2xl lg:max-w-4xl space-y-7">
      <HomeSearchProvider>
        <HomeSearchBar />

        {/* 1. Tracked Exams (Personal dynamic row) */}
        <Suspense fallback={<TrackedExamsSkeleton />}>
          <TrackedExamsSection />
        </Suspense>

        {/* 2. Closing Soon (Lead spotlight) */}
        <Suspense fallback={<ClosingSoonSkeleton />}>
          <ClosingSoonSection />
        </Suspense>

        {/* 3. Just Published */}
        <Suspense fallback={<JustPublishedSkeleton />}>
          <JustPublishedSection />
        </Suspense>

        {/* 4. Popular Exams */}
        <Suspense fallback={<PopularExamsSkeleton />}>
          <PopularExamsSection />
        </Suspense>

        {/* 5. Latest Updates */}
        <Suspense fallback={<LatestUpdatesSkeleton />}>
          <LatestUpdatesSection />
        </Suspense>

        {/* Dynamic Empty Search Results (when searching/filtering) */}
        <HomeEmptySearchResults />

        {/* 6. Guest sign-up CTA for visitors */}
        <Suspense fallback={null}>
          <SignedOutOnly />
        </Suspense>
      </HomeSearchProvider>
    </div>
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
