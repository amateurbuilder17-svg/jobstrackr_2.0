import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { JobCard, JobCardSkeleton } from "@/components/jobs/job-card";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth/session";
import { getProfile } from "@/lib/auth/session";
import { listMatchedJobs } from "@/lib/db/queries/match";

export const metadata: Metadata = {
  title: "For You",
  robots: { index: false, follow: false },
};

/**
 * Jobs this person is actually eligible for.
 *
 * "Actually" is the whole design. The feed excludes anything it cannot verify —
 * an unparseable qualification line, a missing date of birth, an unstated level
 * — so a short list here means the data was thin, not that the matcher is
 * timid. Being wrong in the other direction costs a real application fee.
 */
export default function ForYouPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 lg:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">For You</h1>
      <p className="mt-1 text-sm text-ink-2">
        Openings you meet every stated requirement for — age, qualification and discipline
        included.
      </p>

      <Suspense fallback={<MatchSkeleton />}>
        <Matches />
      </Suspense>
    </div>
  );
}

async function Matches() {
  await requireUser("/for-you");

  const [matches, profile] = await Promise.all([listMatchedJobs(), getProfile()]);

  // The commonest reason for an empty feed is an incomplete profile, and the
  // page should say which field is missing rather than shrug. Age and
  // qualification are hard filters: without them nothing can match at all.
  const missing = [
    profile?.date_of_birth ? null : "date of birth",
    profile?.highest_qualification ? null : "highest qualification",
  ].filter((v) => v !== null);

  if (missing.length > 0) {
    return (
      <div className="mt-6 rounded-lg border border-accent/30 bg-accent/10 px-4 py-6">
        <p className="text-sm font-medium text-ink">
          Add your {missing.join(" and ")} to see matches.
        </p>
        <p className="mt-1 text-sm text-ink-2">
          {missing.length > 1 ? "Both are" : "It is a"} hard{" "}
          {missing.length > 1 ? "requirements" : "requirement"} on almost every notification, so
          this feed would rather show nothing than guess.
        </p>
        <Link
          href="/profile"
          className="mt-3 inline-block text-sm font-medium text-accent hover:underline"
        >
          Complete your profile
        </Link>
      </div>
    );
  }

  if (matches.length === 0) {
    return (
      <div className="mt-6 rounded-lg border border-dashed border-line px-4 py-10 text-center">
        <p className="text-sm font-medium text-ink">Nothing open matches you today.</p>
        <p className="mt-1 text-sm text-ink-2">
          This checks every stated requirement, so it stays quiet rather than suggesting
          something you would be rejected for.
        </p>
        <Link
          href="/jobs"
          className="mt-4 inline-block text-sm font-medium text-accent hover:underline"
        >
          Browse everything instead
        </Link>
      </div>
    );
  }

  return (
    <ul className="mt-6 flex flex-col gap-3">
      {matches.map((job) => (
        <li key={job.id} className="flex flex-col gap-1.5">
          <JobCard job={job} />
          {job.reasons.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 pl-1">
              {job.reasons.map((reason) => (
                <Badge key={reason} tone="accent" className="text-2xs">
                  {reason}
                </Badge>
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function MatchSkeleton() {
  return (
    <div className="mt-6 flex flex-col gap-3">
      <JobCardSkeleton />
      <JobCardSkeleton />
      <JobCardSkeleton />
    </div>
  );
}
