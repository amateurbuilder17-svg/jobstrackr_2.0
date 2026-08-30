import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { JobCard, JobCardSkeleton } from "@/components/jobs/job-card";
import { Badge } from "@/components/ui/badge";
import { getProfile, requireUser } from "@/lib/auth/session";
import { listEducation } from "@/lib/db/queries/education";
import { listFeed, type TieredJob } from "@/lib/db/queries/match";
import { todayInIndia } from "@/lib/format/deadline";
import { describeGap, gapTone } from "@/lib/match/gaps";
import { buildShelves, countTiers, type Shelf } from "@/lib/match/shelves";
import { CompleteMatchProfile } from "./complete-form";
import { MatchPreferences } from "./preferences";

export const metadata: Metadata = {
  title: "For You",
  robots: { index: false, follow: false },
};

/**
 * Jobs this person is actually eligible for.
 *
 * "Actually" is still the whole design. Nothing reaches the matches that has
 * not affirmatively met every requirement the notification states, and being
 * wrong in the other direction costs a real application fee.
 *
 * ── What the tiers are for ────────────────────────────────────────────────
 * A filter that only ever removes things cannot be checked by the person it
 * removes them for, and an empty page saying "nothing matches you" is
 * indistinguishable from a broken one. The old app answered that with four
 * buckets and a reason printed on every card, and that transparency was why
 * people believed it when it went quiet. This is the same four:
 *
 *   Matches         every stated requirement met.
 *   One skill away  every hard requirement met; a skill is not claimed.
 *   Worth checking  nothing failed, but something could not be confirmed —
 *                   either the notification's wording or the profile's silence.
 *   Blocked         exactly one stated requirement definitely failed.
 *
 * The middle two relax nothing. They are the rows the previous version dropped
 * on the floor: a posting whose qualification line the parser could not read
 * was simply absent, which is the same silence as "not for you" and a different
 * fact. Each one now says which half was unreadable, and — when it is the
 * profile's half — the form that fixes it is on this page.
 */
export default function ForYouPage({
  searchParams,
}: {
  searchParams: Promise<{ prefs?: string }>;
}) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 lg:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">For You</h1>
      <p className="mt-1 text-sm text-ink-2">
        Openings you meet every stated requirement for — age, qualification and discipline
        included — and the ones that came close, with the reason.
      </p>

      <Suspense fallback={<MatchSkeleton />}>
        <Matches searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Matches({ searchParams }: { searchParams: Promise<{ prefs?: string }> }) {
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

  // One round trip. Four tiers, their true counts, and every row's reasons and
  // gaps come back together — the counters are a window function over rows the
  // query already scanned, not four more queries.
  const [rows, params] = await Promise.all([listFeed(), searchParams]);

  const counts = countTiers(rows);
  const shelves = buildShelves(rows, {
    today: todayInIndia(),
    state: profile.state,
    preferredStates: profile.preferred_states,
  });
  const review = rows.filter((row) => row.tier === "review");
  const blocked = rows.filter((row) => row.tier === "blocked");

  const notice = params.prefs === "saved" ? "saved" : params.prefs === "slow" ? "slow" : null;

  return (
    <>
      {/* ── The four counters ───────────────────────────────────────────────
          Colour on one tile only. Four tinted boxes is what the old page did,
          and a page where every number is coloured communicates nothing by
          colour — the palette reserves it for genuine state, and "you can apply
          to these" is the state that matters here. */}
      <dl className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Counter label="You can apply" value={counts.can_apply} tone="accent" />
        <Counter label="One skill away" value={counts.skills_gap} />
        <Counter label="Worth checking" value={counts.review} />
        <Counter label="Blocked by one thing" value={counts.blocked} />
      </dl>

      <MatchPreferences profile={profile} open={notice !== null} notice={notice} />

      {counts.can_apply === 0 && counts.skills_gap === 0 ? (
        <EmptyState hasSomething={counts.review > 0 || counts.blocked > 0} />
      ) : null}

      {shelves.map((shelf) => (
        <ShelfSection key={shelf.key} shelf={shelf} />
      ))}

      {/* ── Worth checking ──────────────────────────────────────────────────
          The old app called this "Worth Checking — Verify Eligibility", and it
          is the tier the previous version of this page did not have. Nothing
          here is a match; each row names the thing that could not be
          confirmed. */}
      {review.length > 0 ? (
        <Disclosure
          title="Worth checking"
          count={review.length}
          blurb="Nothing here fails a requirement. Each one states something this feed could not confirm — either the notification did not say, or your profile has not. The ones marked in green are one answer away."
          jobs={review}
        />
      ) : null}

      {/* ── Blocked ─────────────────────────────────────────────────────────
          Unchanged in intent from M17: a relaxation would be the one direction
          this page is not allowed to be wrong in, so a blocked job is rendered
          as blocked, under its own heading, with the single failing test
          named. */}
      {blocked.length > 0 ? (
        <Disclosure
          title="Close, but blocked by one thing"
          count={blocked.length}
          blurb="Each of these fails exactly one stated requirement. Nothing has been relaxed — the notification's own wording is on its page, and age relaxations for reserved categories are granted per notification rather than by this feed."
          jobs={blocked}
        />
      ) : null}
    </>
  );
}

/**
 * One shelf.
 *
 * A ruled heading over a hairline-separated list, which is the shape every
 * other list in this app takes. The old app scrolled these sideways as Netflix
 * rails; a horizontal strip is right for browsing options and wrong for a set
 * of deadlines, which is what these are.
 */
function ShelfSection({ shelf }: { shelf: Shelf }) {
  return (
    <section className="mt-8">
      <div className="flex items-end justify-between gap-4 border-b border-line pb-2.5">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
            <span aria-hidden className="h-4 w-[3px] shrink-0 rounded-full bg-accent" />
            <span className="truncate">{shelf.title}</span>
          </h2>
          {shelf.subtitle ? <p className="mt-1 text-xs text-ink-3">{shelf.subtitle}</p> : null}
        </div>
        <span className="tabular shrink-0 text-xs font-medium text-ink-3">
          {shelf.jobs.length}
        </span>
      </div>

      <ul className="mt-3 flex flex-col gap-3">
        {shelf.jobs.map((job) => (
          <MatchRow key={job.id} job={job} showGaps={shelf.showGaps ?? false} />
        ))}
      </ul>
    </section>
  );
}

/**
 * A job, and its chips.
 *
 * The chips sit outside the card rather than inside it: `JobCard` stretches its
 * title link over the whole row, so anything rendered within it would be
 * covered by that overlay and unclickable — and, worse, would be read as part
 * of the link's accessible name.
 */
function MatchRow({ job, showGaps }: { job: TieredJob; showGaps: boolean }) {
  const chips = showGaps
    ? job.gaps.map(describeGap)
    : job.reasons.map((reason) => ({ code: reason, label: reason, kind: "reason" as const }));

  return (
    <li className="flex flex-col gap-1.5">
      <JobCard job={job} />
      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pl-1">
          {chips.map((chip) => (
            <Badge
              key={chip.code}
              tone={chip.kind === "reason" ? "accent" : gapTone(chip.kind)}
              className="text-2xs"
            >
              {chip.label}
            </Badge>
          ))}
        </div>
      ) : null}
    </li>
  );
}

/**
 * A collapsed section of jobs with their gaps named.
 *
 * `<details>`, not a state-holding disclosure component. It is collapsed by
 * default, works before hydration, and costs nothing — these are secondary
 * sections and should not put JavaScript on a page whose main list is already
 * server-rendered.
 */
function Disclosure({
  title,
  count,
  blurb,
  jobs,
}: {
  title: string;
  count: number;
  blurb: string;
  jobs: readonly TieredJob[];
}) {
  return (
    <section className="mt-10">
      <details className="group rounded-lg border border-line bg-surface">
        <summary
          className={
            "flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 " +
            "text-sm font-semibold text-ink transition-colors duration-(--duration-fast) " +
            "hover:bg-surface-2"
          }
        >
          <span>{title}</span>
          <span className="tabular text-xs font-medium text-ink-3">
            {count} {count === 1 ? "job" : "jobs"}
          </span>
        </summary>

        <div className="border-t border-line px-4 py-4">
          <p className="text-sm text-ink-2">{blurb}</p>
          <ul className="mt-4 flex flex-col gap-3">
            {jobs.map((job) => (
              <MatchRow key={job.id} job={job} showGaps />
            ))}
          </ul>
        </div>
      </details>
    </section>
  );
}

function Counter({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "accent" | "neutral";
}) {
  return (
    <div
      className={
        "rounded-lg border px-3 py-2.5 " +
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

function EmptyState({ hasSomething }: { hasSomething: boolean }) {
  return (
    <div className="mt-6 rounded-lg border border-dashed border-line px-4 py-8 text-center">
      <p className="text-sm font-medium text-ink">Nothing open matches you today.</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-ink-2">
        {hasSomething
          ? "There are postings below that came close. Each says what stopped it — several of them are waiting on an answer you can give above."
          : "This checks every stated requirement, so it stays quiet rather than suggesting something you would be rejected for."}
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

function MatchSkeleton() {
  return (
    <div className="mt-6 flex flex-col gap-3">
      <JobCardSkeleton />
      <JobCardSkeleton />
      <JobCardSkeleton />
    </div>
  );
}
