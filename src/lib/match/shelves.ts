import type { MatchTier, TieredJob } from "@/lib/db/queries/match";
import { daysUntilFrom } from "@/lib/format/deadline";

/**
 * The old app's Netflix rows, rebuilt from one query.
 *
 * `feedBuilder.buildFeed` in the old codebase took eight arrays and a
 * similarity map and produced nine shelves. It could, because everything was
 * already in the browser — including a table scan per saved job to find
 * "similar" ones, which is exactly the shape of read this rebuild exists to
 * remove.
 *
 * This takes one array. Every shelf is a partition or a filter of the rows
 * `match_feed` already returned, so adding a shelf costs no query and removing
 * one saves none. That constraint is what keeps the page at a single round
 * trip while still reading as the old one did.
 *
 * ── Deduplication ─────────────────────────────────────────────────────────
 * A job appears in at most one shelf, first come. This is the old `take()`
 * helper, and it is the reason the narrow shelves are worth having: "closing
 * soon" below "matches for you" is not a repeat of the same six cards, it is
 * the ones the first shelf did not have room for.
 *
 * ── Deliberately not brought across ───────────────────────────────────────
 * "Because you saved X" and the "Saved jobs" shelf. The first needed a
 * similarity pass over every row in the table; the second duplicates /saved,
 * which is a nav item in this app and was not in the old one.
 */

export interface Shelf {
  key: string;
  title: string;
  /** One line saying what the row is for. Six rows of bare nouns do not. */
  subtitle?: string;
  jobs: TieredJob[];
  /** Render each card's gap chips under it. */
  showGaps?: boolean;
}

export interface ShelfContext {
  /** `todayInIndia()`. Passed in so the shelves are pure and testable. */
  today: string;
  /** The candidate's home state, for the "in your state" shelf. */
  state: string | null;
  preferredStates: readonly string[];
}

/** Counts per tier, taken from the row that carries them. */
export type TierCounts = Record<MatchTier, number>;

export function countTiers(rows: readonly TieredJob[]): TierCounts {
  const counts: TierCounts = { can_apply: 0, skills_gap: 0, review: 0, blocked: 0 };
  for (const row of rows) {
    // Every row in a tier carries the same `tier_total`, so this assigns rather
    // than accumulates — the value is the count before the per-tier cap, which
    // is the number the counters must show.
    counts[row.tier] = row.tier_total;
  }
  return counts;
}

export function buildShelves(rows: readonly TieredJob[], context: ShelfContext): Shelf[] {
  const seen = new Set<string>();

  /** n unique, unseen jobs. The old `take()`, unchanged in behaviour. */
  const take = (candidates: readonly TieredJob[], n: number): TieredJob[] => {
    const out: TieredJob[] = [];
    for (const job of candidates) {
      if (seen.has(job.id)) continue;
      seen.add(job.id);
      out.push(job);
      if (out.length >= n) break;
    }
    return out;
  };

  const inTier = (tier: MatchTier) => rows.filter((row) => row.tier === tier);
  const canApply = inTier("can_apply");

  const shelves: Shelf[] = [];

  const push = (shelf: Omit<Shelf, "jobs">, jobs: TieredJob[]) => {
    if (jobs.length > 0) shelves.push({ ...shelf, jobs });
  };

  // ── 1. The matches themselves ────────────────────────────────────────────
  // Already ordered by the ranking in `match_feed`: tracked exams first, then
  // sector and state, then urgency.
  push(
    {
      key: "matches",
      title: "Matches for you",
      subtitle: "You meet every requirement these state.",
    },
    take(canApply, 20),
  );

  // ── 2. Closing soon ──────────────────────────────────────────────────────
  // Only ever the matches the first shelf had no room for. A deadline inside a
  // week is the one thing worth interrupting the ranking for.
  push(
    {
      key: "closing",
      title: "Closing this week",
      subtitle: "Matches whose application window shuts within seven days.",
    },
    take(
      canApply.filter((job) => {
        const days = daysUntilFrom(context.today, job.last_date);
        return days !== null && days >= 0 && days <= 7;
      }),
      10,
    ),
  );

  // ── 3. In your state ─────────────────────────────────────────────────────
  const states = new Set(
    [context.state, ...context.preferredStates]
      .filter((s): s is string => Boolean(s) && s !== "All India")
      .map((s) => s.toLowerCase()),
  );
  if (states.size > 0) {
    const label =
      context.preferredStates.length === 1
        ? (context.preferredStates[0] ?? "your state")
        : (context.state ?? "your states");
    push(
      {
        key: "state",
        title: `More in ${label}`,
        subtitle: "Posted for the states you said you would move to, or already live in.",
      },
      take(
        canApply.filter((job) => job.state !== null && states.has(job.state.toLowerCase())),
        10,
      ),
    );
  }

  // ── 4. Large recruitments ────────────────────────────────────────────────
  // A hundred vacancies is a materially different chance from three, and the
  // old app ranked on it for that reason.
  push(
    {
      key: "vacancies",
      title: "Large recruitments",
      subtitle: "A hundred posts or more — the odds are meaningfully better.",
    },
    take(
      canApply
        .filter((job) => (job.vacancies ?? 0) >= 100)
        .toSorted((a, b) => (b.vacancies ?? 0) - (a.vacancies ?? 0)),
      10,
    ),
  );

  // ── 5. One skill away ────────────────────────────────────────────────────
  // The old app's "Almost There", including its threshold: one or two gaps is
  // close, and five is a different job. Rows with more stay in the counter and
  // out of the shelf.
  push(
    {
      key: "skills",
      title: "One skill away",
      subtitle:
        "You meet every hard requirement. Each of these also asks for something you have not claimed.",
      showGaps: true,
    },
    take(
      inTier("skills_gap").filter((job) => job.gaps.length <= 2),
      12,
    ),
  );

  return shelves;
}
