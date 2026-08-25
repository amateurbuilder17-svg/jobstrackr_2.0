import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { JobCard, JobCardSkeleton } from "@/components/jobs/job-card";
import { Badge } from "@/components/ui/badge";
import { getProfile, requireUser } from "@/lib/auth/session";
import { listEducation } from "@/lib/db/queries/education";
import { listBlockedJobs, listMatchedJobs, type BlockedJob } from "@/lib/db/queries/match";
import { QUALIFICATION_LABELS, type QUALIFICATION_LEVELS } from "@/lib/profile/enums";
import { CompleteMatchProfile } from "./complete-form";

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
 *
 * ── The two things this page owes the reader ──────────────────────────────
 * A filter that only ever removes things cannot be checked by the person it
 * removes them for, and an empty page that says "nothing matches you" is
 * indistinguishable from a broken one. So:
 *
 *   **It can be fixed here.** The three fields the matcher cannot work without
 *   are a form on this page, not a link to another one.
 *
 *   **It shows its working.** Jobs that failed exactly one test appear under
 *   the matches with that test named. This relaxes nothing — a blocked job is
 *   rendered as blocked — but it is the difference between a quiet feed you
 *   trust and a quiet feed you assume is broken.
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

  const profile = await getProfile();

  // Age and qualification are hard filters: without them nothing can match at
  // all, and the honest response is a form rather than an empty state.
  const incomplete = !profile?.date_of_birth || !profile.highest_qualification;

  if (incomplete) {
    const education = await listEducation();
    return (
      <CompleteMatchProfile
        dateOfBirth={profile?.date_of_birth ?? null}
        highestQualification={profile?.highest_qualification ?? null}
        discipline={education[0]?.discipline ?? null}
      />
    );
  }

  // One round trip each, in parallel. The counters are derived from these two
  // arrays rather than from two further count queries — a number on a card is
  // not worth a query of its own.
  const [matches, blocked] = await Promise.all([listMatchedJobs(), listBlockedJobs()]);

  return (
    <>
      <dl className="mt-6 grid grid-cols-2 gap-3">
        <Counter label="You can apply" value={matches.length} tone="accent" />
        {/* Two buckets, not the old page's four. "Skills gap" and "Review"
            needed a soft-eligibility model this schema deliberately does not
            have — no column records stenography or typing speed, and inventing
            a bucket for them would be inventing the data too. */}
        <Counter label="Blocked by one thing" value={blocked.length} tone="neutral" />
      </dl>

      {matches.length === 0 ? (
        <div className="mt-6 rounded-lg border border-dashed border-line px-4 py-8 text-center">
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
      ) : (
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
      )}

      {blocked.length > 0 ? (
        <section className="mt-10">
          {/* `<details>`, not a state-holding disclosure component. It is
              collapsed by default, works before hydration, and costs nothing —
              this is a secondary section and should not put JavaScript on a
              page whose main list is already server-rendered. */}
          <details className="group rounded-lg border border-line bg-surface">
            <summary
              className={
                "flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 " +
                "text-sm font-semibold text-ink transition-colors duration-(--duration-fast) " +
                "hover:bg-surface-2"
              }
            >
              <span>Close, but blocked by one thing</span>
              <span className="tabular text-xs font-medium text-ink-3">
                {blocked.length} {blocked.length === 1 ? "job" : "jobs"}
              </span>
            </summary>

            <div className="border-t border-line px-4 py-4">
              <p className="text-sm text-ink-2">
                Each of these fails exactly one stated requirement. Nothing here has been
                relaxed — the notification&rsquo;s own wording is on its page, and age
                relaxations for reserved categories are granted per notification rather than by
                this feed.
              </p>
              <ul className="mt-4 flex flex-col gap-3">
                {blocked.map((job) => (
                  <li key={job.id} className="flex flex-col gap-1.5">
                    <JobCard job={job} />
                    <div className="pl-1">
                      <Badge tone="warn" className="text-2xs">
                        {describeBlocker(job)}
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </section>
      ) : null}
    </>
  );
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "accent" | "neutral";
}) {
  return (
    <div
      className={
        "rounded-lg border px-4 py-3 " +
        (tone === "accent" ? "border-accent-line bg-accent-soft" : "border-line bg-surface")
      }
    >
      <dd
        className={
          "tabular text-2xl font-semibold " + (tone === "accent" ? "text-accent" : "text-ink")
        }
      >
        {value}
      </dd>
      <dt className="mt-0.5 text-xs font-medium text-ink-3">{label}</dt>
    </div>
  );
}

/**
 * The sentence for one blocker.
 *
 * Composed here rather than in SQL because the labels already exist here —
 * `QUALIFICATION_LABELS` is what the profile form renders, and a second copy in
 * Postgres would be two lists that disagree the first time one is edited.
 */
function describeBlocker(job: BlockedJob): string {
  switch (job.blocker) {
    case "age": {
      const [range = "", age = ""] = job.blocker_value.split("|");
      const [min, max] = range.split("-");
      const window = min && max ? `${min}–${max}` : min ? `${min}+` : `up to ${max ?? ""}`;
      return age ? `Age limit ${window}, you are ${age}` : `Age limit ${window}`;
    }
    case "qualification": {
      const level = job.blocker_value as (typeof QUALIFICATION_LEVELS)[number];
      const label = QUALIFICATION_LABELS[level] as string | undefined;
      return label ? `Requires ${label}` : "Requires a higher qualification";
    }
    case "stream":
      return job.blocker_value
        ? `Requires a ${job.blocker_value} discipline`
        : "Requires a different discipline";
    case "gender":
      return job.blocker_value === "female" ? "Open to women only" : "Open to men only";
    case "experience":
      return job.blocker_value
        ? `Needs ${job.blocker_value} years of experience`
        : "Needs more experience";
  }
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
