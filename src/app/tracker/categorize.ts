/**
 * Which of the three groups a tracked exam belongs in.
 *
 * ## Why this is not just a switch on `attempt.status`
 *
 * It used to be, and it was wrong in the way that matters: `tracking`,
 * `applied` and `admit_card` all meant "Action Required". Those are the three
 * statuses almost every live attempt has, so "Action Required" held everything,
 * "Upcoming" held only the handful of rows somebody had manually marked
 * `appeared`, and the header underneath the title read "8 tracked · 8 need
 * attention" — a number that cannot be acted on, which is the same as no
 * number at all.
 *
 * The grouping people actually want is about *dates*, not about a dropdown
 * somebody set once:
 *
 * - **Action Required** — something has to be done, and it has a deadline.
 *   The application closes this week; the admit card is downloadable now; the
 *   result is out; the exam is in three days.
 * - **Upcoming** — tracked and waiting. Applied and waiting for the admit
 *   card, exam scheduled for October, sat the paper and waiting for a result.
 * - **Completed** — over. The candidate settled it (passed / not selected /
 *   withdrawn), or the final result was declared long enough ago that nagging
 *   about it is noise.
 *
 * ## Where the facts come from, in order of authority
 *
 * 1. **The candidate's own status** — `passed`, `failed`, `withdrawn` and
 *    `appeared` are statements only its owner can make, and they win.
 * 2. **The AI status report** — the verified per-phase picture, when there is
 *    one. See `lib/exams/report.ts`.
 * 3. **The job notification** — `last_date` is the application deadline, and
 *    it is a fact about the notification that nothing on the attempt row can
 *    supply.
 * 4. **The updates feed** — an `admit_card` or `result` post published for
 *    this exam. Consulted *only* where there is no report, and only while
 *    recent: a feed entry is about the exam, not about this candidate's phase,
 *    so it is the weakest of the four and is treated as such.
 *
 * Everything here is pure and date-driven so it can be tested against a fixed
 * "today" rather than against the clock — see `categorize.test.ts`.
 */

import type { ExamAttempt } from "@/lib/db/queries/attempts";
import type { ExamUpdateSignal } from "@/lib/db/queries/exam-updates";
import {
  examDateOf,
  hasSecondPhase,
  phaseOf,
  resultDateOf,
  type ExamStatusReport,
  type StatusPhase,
} from "@/lib/exams/report";
import { daysUntilFrom } from "@/lib/format/deadline";
import type { AttemptStatus } from "@/lib/tracker/enums";
import { isStage2 } from "./exam-progress";

export type ExamCategory = "action" | "upcoming" | "completed";

/** Statuses only the candidate can set. Reaching one ends the tracking. */
const SETTLED: ReadonlySet<AttemptStatus> = new Set<AttemptStatus>([
  "passed",
  "failed",
  "withdrawn",
]);

/**
 * The windows, in days, and the reasoning for each.
 *
 * They are the whole behaviour of this module, so they are named and grouped
 * rather than spelled inline where a reader would have to infer what `10`
 * meant.
 */
const WINDOW = {
  /**
   * A closing date this near is tonight's job, not next month's. Ten days
   * rather than three: government applications need documents, photographs and
   * a fee, so the useful warning is longer than the one a job board gives.
   */
  applyClosing: 10,
  /** With the exam this close, the admit card and ID have to be in hand. */
  examImminent: 3,
  /** "Your result is out" stops being news after a month. */
  resultFresh: 30,
  /** Same, measured from the exam when no result date is known. */
  resultFreshFromExam: 60,
  /** A feed entry older than this proves nothing about today. */
  updateFresh: 45,
  /** An exam this long past, with nothing pending after it, is history. */
  examStale: 180,
} as const;

export interface CategoryInput {
  status: AttemptStatus;
  /** The candidate's own phase text — "Mains", "Tier 2". */
  stage: string | null;
  appliedAt: string | null;
  examDate: string | null;
  resultDate: string | null;
  /** `jobs.last_date` — the last date to apply, from the notification. */
  applyDeadline: string | null;
  report: ExamStatusReport | null;
  updates: readonly ExamUpdateSignal[];
  /** Today in India, `YYYY-MM-DD`. Null disables every date-based rule. */
  today: string | null;
}

export interface CategoryResult {
  category: ExamCategory;
  /**
   * Why, in the words the card would use. Shown nowhere yet; it exists so a
   * wrong grouping can be explained without re-deriving it, and so the tests
   * assert on the reason rather than only on the bucket.
   */
  reason: string;
  /** The date the grouping hangs on. Sections order by it. */
  sortDate: string | null;
}

/* ── The updates feed, read defensively ────────────────────────────────── */

interface FeedSignals {
  admitCard: string | null;
  result: string | null;
}

/**
 * The newest dated entry per category, discarding anything stale or undated.
 *
 * An undated update is skipped rather than trusted: `published_date` is what
 * makes a feed entry mean "now" rather than "at some point", and an admit-card
 * post from last year's cycle moving a row into "Action Required" is exactly
 * the false alarm this whole module exists to avoid.
 */
function readFeed(updates: readonly ExamUpdateSignal[], today: string | null): FeedSignals {
  const newest = (category: ExamUpdateSignal["category"]): string | null => {
    for (const update of updates) {
      if (update.category !== category) continue;
      const date = update.publishedDate;
      if (!date) continue;
      if (today) {
        const age = daysUntilFrom(today, date);
        if (age === null || age < -WINDOW.updateFresh) continue;
      }
      return date;
    }
    return null;
  };

  return { admitCard: newest("admit_card"), result: newest("result") };
}

/* ── The rules ─────────────────────────────────────────────────────────── */

export function categorize(input: CategoryInput): CategoryResult {
  const { status, today } = input;
  const days = (date: string | null): number | null =>
    today && date ? daysUntilFrom(today, date) : null;

  // 1. The candidate has said how it ended. Nothing else can override that.
  if (SETTLED.has(status)) {
    return {
      category: "completed",
      reason:
        status === "passed" ? "Qualified" : status === "failed" ? "Not selected" : "Withdrawn",
      sortDate: input.resultDate ?? input.examDate,
    };
  }

  const report = input.report?.report ?? null;
  const twoPhases = report ? hasSecondPhase(report) : false;
  const atPhase2 = twoPhases && isStage2(input.stage);
  const phase1 = report ? phaseOf(report, 1) : null;
  const phase2 = report ? phaseOf(report, 2) : null;

  /** The phase this candidate is living in — the one their card is about. */
  const active: StatusPhase | null = atPhase2 ? phase2 : phase1;
  /** The phase that ends the exam, whoever is where. */
  const finalPhase: StatusPhase | null = twoPhases ? phase2 : phase1;

  const feed = readFeed(input.updates, today);
  /** The feed only speaks where the report is silent. See the header. */
  const feedOnly = report === null;

  const resultOut =
    active?.resultAvailable === true ||
    active?.status === "result_declared" ||
    (feedOnly && feed.result !== null);

  const processFinished =
    finalPhase?.resultAvailable === true || finalPhase?.status === "result_declared";

  const resultDate = input.resultDate ?? active?.resultDate ?? (feedOnly ? feed.result : null);

  /**
   * Has this candidate actually entered the exam?
   *
   * `tracking` with no `applied_at` is the status of a row somebody added to
   * watch — nobody sat anything. A result declared against such a row is the
   * commission publishing the *previous* cycle's outcome, and telling that
   * person their result is out is simply false. It is the one place the feed
   * and the report both need this guard, so it is applied to the fact rather
   * than to either source.
   */
  const engaged = status !== "tracking" || input.appliedAt !== null;

  // 2. A declared result is the loudest thing that can happen to a tracked
  //    exam — but only for as long as the candidate could plausibly not have
  //    seen it. After that it is history, not a task.
  if (resultOut) {
    const resultAge = days(resultDate);
    const examAge = days(input.examDate);
    const fresh =
      resultAge !== null
        ? resultAge >= -WINDOW.resultFresh
        : examAge !== null
          ? examAge >= -WINDOW.resultFreshFromExam
          : true;

    if (fresh && engaged) {
      return {
        category: "action",
        reason: twoPhases && !atPhase2 ? "Prelims result declared" : "Result declared",
        sortDate: resultDate,
      };
    }
    if (processFinished && !fresh) {
      return { category: "completed", reason: "Result declared", sortDate: resultDate };
    }
    // Otherwise a later phase is still pending, or this candidate was never
    // in it — fall through and let the dates decide.
  }

  // 3. An admit card that can be downloaded right now.
  //
  //    `status === "admit_card"` counts because that is the one status the app
  //    sets automatically from a confident report (`deriveAttemptStatus`), and
  //    because a candidate who set it by hand is telling us the same fact.
  //    The feed's version of the same fact is gated on `engaged` where the
  //    report's is not: `deriveAttemptStatus` already promotes a watching row
  //    to `admit_card` when a *confident report* says so, and that is the
  //    app's settled position. A feed post is a weaker claim about a whole
  //    exam, and an admit card is a thing only applicants can download.
  if (
    status === "admit_card" ||
    active?.admitCardAvailable === true ||
    (feedOnly && feed.admitCard !== null && engaged)
  ) {
    return {
      category: "action",
      reason: "Admit card available",
      sortDate: input.examDate ?? active?.examDate ?? null,
    };
  }

  // 4. The application is about to close and this candidate has not applied.
  //
  //    "Has not applied" is deliberately strict: `applied_at` set, or any
  //    status past `tracking`, means the form is in and the deadline is no
  //    longer their problem.
  const notApplied = status === "tracking" && input.appliedAt === null;
  const deadline =
    report?.events.find((event) => event.type === "application_close")?.date ??
    input.applyDeadline;
  const untilDeadline = days(deadline);

  if (
    notApplied &&
    untilDeadline !== null &&
    untilDeadline >= 0 &&
    untilDeadline <= WINDOW.applyClosing
  ) {
    return {
      category: "action",
      reason: untilDeadline === 0 ? "Applications close today" : "Applications closing",
      sortDate: deadline,
    };
  }

  // 5. The exam itself is days away.
  const examDate = input.examDate ?? active?.examDate ?? null;
  const untilExam = days(examDate);
  if (untilExam !== null && untilExam >= 0 && untilExam <= WINDOW.examImminent) {
    return {
      category: "action",
      reason: untilExam === 0 ? "Exam today" : "Exam in days",
      sortDate: examDate,
    };
  }

  // 6. Nothing is pending and the exam is long gone. A row that has sat in
  //    "Upcoming" since last year is not upcoming; it is an artefact of nobody
  //    having gone back to mark it.
  //
  //    "Pending" spans every date the exam could still turn on, not just this
  //    candidate's own exam date: a Mains sitting in November keeps a Prelims
  //    from last winter live.
  //    The dates come through `examDateOf` / `resultDateOf` rather than off the
  //    phase objects directly, because those accessors also read the model's
  //    dated *events* — and they are what the "Next milestone" box on the same
  //    card uses. Reading the dates a different way is how a card ends up
  //    filed under one date while displaying another.
  const dates: { date: string | null; kind: "exam" | "result" | "deadline" }[] = [
    { date: examDate, kind: "exam" },
    { date: input.resultDate ?? resultDate, kind: "result" },
    { date: report ? examDateOf(report, 1) : null, kind: "exam" },
    { date: report ? resultDateOf(report, 1) : null, kind: "result" },
    { date: twoPhases && report ? examDateOf(report, 2) : null, kind: "exam" },
    { date: twoPhases && report ? resultDateOf(report, 2) : null, kind: "result" },
    // Only for somebody who still has to file it — a closing date is not a
    // date this candidate is waiting on once their form is in.
    { date: notApplied ? deadline : null, kind: "deadline" },
  ];

  const ahead = dates
    .filter((entry): entry is { date: string; kind: "exam" | "result" | "deadline" } => {
      const until = entry.date === null ? null : days(entry.date);
      return until !== null && until >= 0;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const examAge = days(examDate);
  if (ahead.length === 0 && examAge !== null && examAge < -WINDOW.examStale) {
    return { category: "completed", reason: "Exam over", sortDate: examDate };
  }

  // 7. Tracked, dated or not, and waiting.
  //
  //    The date reported is the *next* one, not merely the first one that
  //    happens to be non-null. A row whose Prelims was in May and whose Mains
  //    is in November is waiting on November, and ordering it by May would
  //    file it ahead of an exam happening next week.
  const next = ahead[0];
  const examPast = examAge !== null && examAge < 0;

  return {
    category: "upcoming",
    reason: next
      ? next.kind === "exam"
        ? "Exam scheduled"
        : next.kind === "result"
          ? "Awaiting result"
          : "Applications open"
      : status === "appeared" || examPast
        ? "Awaiting result"
        : status === "applied"
          ? "Applied"
          : "Tracking",
    sortDate: next?.date ?? examDate ?? resultDate ?? deadline,
  };
}

/* ── The page's view of it ─────────────────────────────────────────────── */

export interface CategorizedAttempt extends CategoryResult {
  attempt: ExamAttempt;
  report: ExamStatusReport | null;
}

/** Section order, so one sort puts the whole list in reading order. */
const CATEGORY_ORDER: Record<ExamCategory, number> = {
  action: 0,
  upcoming: 1,
  completed: 2,
};

/**
 * Where a row sorts inside its section: 0 for something still ahead of the
 * candidate, 1 for something already behind them or undated.
 *
 * A date in the past is not urgent, however recent. Sorting purely on the
 * string put a result declared three weeks ago above an application closing
 * on Friday, which is the wrong way round in the one section whose whole job
 * is to say what to do first.
 */
function urgencyGroup(sortDate: string | null, today: string | null): 0 | 1 {
  const until = today && sortDate ? daysUntilFrom(today, sortDate) : null;
  return until !== null && until >= 0 ? 0 : 1;
}

/**
 * Categorise a page of attempts and put them in the order they are read in.
 *
 * Within "Action Required" and "Upcoming" the soonest date still to come is
 * first, which is the only ordering that makes an urgency group mean anything.
 * Anything already behind the candidate follows, most recent first, and so
 * does "Completed" as a whole — the thing that just finished is the one worth
 * seeing. Undated rows sort last everywhere: a row with no date cannot be more
 * urgent than one with a date on it.
 */
export function categorizeAttempts(
  attempts: readonly ExamAttempt[],
  reports: Record<string, ExamStatusReport>,
  signals: Record<string, readonly ExamUpdateSignal[]>,
  today: string | null,
  keyOf: (attempt: ExamAttempt) => string | null,
): CategorizedAttempt[] {
  const items = attempts.map((attempt): CategorizedAttempt => {
    const key = keyOf(attempt);
    const report = (key === null ? undefined : reports[key]) ?? null;
    const updates = (key === null ? undefined : signals[key]) ?? [];

    return {
      attempt,
      report,
      ...categorize({
        status: attempt.status as AttemptStatus,
        stage: attempt.stage,
        appliedAt: attempt.applied_at,
        examDate: attempt.exam_date,
        resultDate: attempt.result_date,
        applyDeadline: attempt.job?.last_date ?? null,
        report,
        updates,
        today,
      }),
    };
  });

  return items.sort((a, b) => {
    const byCategory = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
    if (byCategory !== 0) return byCategory;

    const groupA = urgencyGroup(a.sortDate, today);
    const groupB = urgencyGroup(b.sortDate, today);
    if (groupA !== groupB) return groupA - groupB;

    if (a.sortDate === b.sortDate) return 0;
    if (a.sortDate === null) return 1;
    if (b.sortDate === null) return -1;

    // Ahead of the candidate: soonest first. Behind them: latest first.
    return groupA === 0 && a.category !== "completed"
      ? a.sortDate.localeCompare(b.sortDate)
      : b.sortDate.localeCompare(a.sortDate);
  });
}

/** How many rows are in each group, for the tabs and the header line. */
export function countByCategory(
  items: readonly CategorizedAttempt[],
): Record<ExamCategory, number> {
  return {
    action: items.filter((item) => item.category === "action").length,
    upcoming: items.filter((item) => item.category === "upcoming").length,
    completed: items.filter((item) => item.category === "completed").length,
  };
}
