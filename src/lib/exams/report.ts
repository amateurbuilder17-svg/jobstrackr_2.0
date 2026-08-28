/**
 * The canonical shape of an AI exam-status report, and everything that reads it.
 *
 * Zero imports beyond the tracker's own vocabulary, for the reason stated in
 * `tracker/enums.ts`: this module is imported by a Client Component, and a
 * module that reaches these types through anything containing `z.object(...)`
 * at top level pulls all of Zod into the browser bundle.
 *
 * ## Why the shape is fixed here rather than wherever the model happens to land
 *
 * The old app stored the model's raw JSON and made every reader cope. Four
 * historical shapes accumulated — `phase_1` vs `phases.phase1`, flat
 * `exam_dates` vs `predicted_events`, `event_type: "exam"` vs `"exam_date"` —
 * and the card that read them grew to 1,321 lines, most of it fallback chains
 * three deep. A helper called `getPhaseData` existed whose entire job was to
 * guess which era a cached row came from.
 *
 * Here the normalising happens once, on the way in (`parseStatusReport`), and
 * what is written to `exam_status_reports.report` is always this shape. The
 * accessors below are therefore plain field reads: if `phases[0]` is absent,
 * the model genuinely said nothing about phase one, not that it said it
 * somewhere else.
 *
 * camelCase, unlike every column in this app, because this is an opaque JSONB
 * blob owned entirely by the application — PostgREST never maps a field of it,
 * so the snake_case convention buys nothing and costs a conversion at every
 * boundary.
 */

import type { AttemptStatus } from "@/lib/tracker/enums";

/* ── Vocabulary ────────────────────────────────────────────────────────── */

/**
 * Where the exam as a whole has got to, in the order it gets there.
 *
 * The order is the point: progress, "is this newer than what we had", and the
 * step rail all read the index rather than a lookup table that could disagree
 * with it.
 */
export const EXAM_STAGES = [
  "not_yet_notified",
  "registration_open",
  "registration_closed",
  "exam_scheduled",
  "admit_card_available",
  "exam_completed",
  "result_declared",
] as const;

export type ExamStage = (typeof EXAM_STAGES)[number];

export const STAGE_LABELS: Record<ExamStage, string> = {
  not_yet_notified: "Not notified yet",
  registration_open: "Applications open",
  registration_closed: "Applications closed",
  exam_scheduled: "Exam scheduled",
  admit_card_available: "Admit card out",
  exam_completed: "Exam over",
  result_declared: "Result declared",
};

/** A phase may also be "not applicable" — most exams have one phase, not two. */
export const PHASE_STATUSES = [...EXAM_STAGES, "not_applicable"] as const;
export type PhaseStatus = (typeof PHASE_STATUSES)[number];

export const EVENT_TYPES = [
  "application_open",
  "application_close",
  "admit_card",
  "exam_date",
  "result",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_LABELS: Record<EventType, string> = {
  application_open: "Applications open",
  application_close: "Last date to apply",
  admit_card: "Admit card",
  exam_date: "Exam",
  result: "Result",
};

/* ── The report ────────────────────────────────────────────────────────── */

export interface StatusPhase {
  /** The official name — "Tier 1", "Prelims", "CBT 1". Never "Phase 1". */
  name: string;
  status: PhaseStatus;
  /**
   * True only when a candidate can download it right now.
   *
   * The single most-wrong field in the old implementation, and the reason it
   * ended up with a 40-entry keyword list: asked for a boolean, the model
   * regularly answered `"February 7 expected"`, which is truthy. It is a
   * strict boolean by the time it is stored, and an announced-but-not-issued
   * admit card is `false` — which is what the person refreshing actually
   * needs to know.
   */
  admitCardAvailable: boolean;
  admitCardLink: string | null;
  /** ISO date, `YYYY-MM-DD`. */
  examDate: string | null;
  examDetails: string | null;
  resultAvailable: boolean;
  resultLink: string | null;
  resultDate: string | null;
}

export interface StatusEvent {
  type: EventType;
  /** 1 or 2 where the model attributed it to a phase, otherwise null. */
  phase: number | null;
  /** ISO date. An event without a usable date is dropped, never stored. */
  date: string;
  certainty: "high" | "medium" | "low" | null;
  notes: string | null;
}

export interface StatusReport {
  summary: string | null;
  stage: ExamStage;
  /** One entry for a single-phase exam, two for Prelims + Mains. Never empty. */
  phases: StatusPhase[];
  events: StatusEvent[];
  updates: string[];
  recommendations: string[];
  /** The model's own 0–100 confidence in the whole answer. */
  confidence: number | null;
}

export interface StatusSource {
  title: string;
  url: string;
}

/** A stored report, as the tracker reads it back. */
export interface ExamStatusReport {
  subjectKey: string;
  subjectLabel: string;
  report: StatusReport;
  confidence: number | null;
  model: string;
  /** False when the answer came from model memory rather than a live search. */
  grounded: boolean;
  sources: StatusSource[];
  refreshedAt: string;
}

/* ── Freshness ─────────────────────────────────────────────────────────── */

const HOUR = 60 * 60 * 1000;

/** A confident answer is good for a day. Government dates do not move hourly. */
export const FRESH_MS = 24 * HOUR;

/**
 * A hedging answer is good for two hours.
 *
 * The old function refused to cache anything below 70 at all, which meant the
 * user paid for a call and got nothing stored — press Refresh twice and it
 * costs two calls to see the same uncertain answer. Storing it and expiring it
 * early keeps the answer on screen while making the next look cheap to retry.
 */
export const FRESH_LOW_CONFIDENCE_MS = 2 * HOUR;

/** Below this, a report is treated as a hedge: short-lived, and never automatic. */
export const CONFIDENCE_FLOOR = 70;

export function isConfident(confidence: number | null): boolean {
  return confidence === null || confidence >= CONFIDENCE_FLOOR;
}

export function isStale(
  refreshedAt: string,
  confidence: number | null,
  now: Date = new Date(),
): boolean {
  const age = now.getTime() - new Date(refreshedAt).getTime();
  if (Number.isNaN(age)) return true;
  return age > (isConfident(confidence) ? FRESH_MS : FRESH_LOW_CONFIDENCE_MS);
}

/* ── Accessors ─────────────────────────────────────────────────────────── */

/** Phase by 1-based number, or null where the exam has no such phase. */
export function phaseOf(report: StatusReport, phase: 1 | 2): StatusPhase | null {
  return report.phases[phase - 1] ?? null;
}

export function hasSecondPhase(report: StatusReport): boolean {
  const second = report.phases[1];
  return second !== undefined && second.status !== "not_applicable";
}

/**
 * How far along, as a percentage.
 *
 * Derived from the stage's position in `EXAM_STAGES` rather than from a hand
 * written table of four magic numbers, so adding a stage cannot leave the bar
 * disagreeing with the label beside it. The floor of 8% is deliberate: a bar
 * at literally zero reads as "broken", not as "nothing has happened yet".
 */
export function progressOf(report: StatusReport): number {
  const index = EXAM_STAGES.indexOf(report.stage);
  if (index < 0) return 8;
  const pct = Math.round((index / (EXAM_STAGES.length - 1)) * 100);
  return Math.max(8, pct);
}

/** The first dated event of a type, for the timeline. */
export function nextEventOf(report: StatusReport, type: EventType): StatusEvent | null {
  return report.events.find((e) => e.type === type) ?? null;
}

/**
 * The exam date to show for a phase: the phase's own, falling back to an event
 * the model attributed to that phase.
 *
 * This is the one fallback that survives normalising, because the two fields
 * genuinely carry different information — `examDate` is the scheduled date,
 * an `exam_date` event may be a prediction with a confidence attached.
 */
export function examDateOf(report: StatusReport, phase: 1 | 2): string | null {
  const own = phaseOf(report, phase)?.examDate;
  if (own) return own;
  const event = report.events.find(
    (e) => e.type === "exam_date" && (e.phase === phase || e.phase === null),
  );
  return event?.date ?? null;
}

export function resultDateOf(report: StatusReport, phase: 1 | 2): string | null {
  const own = phaseOf(report, phase)?.resultDate;
  if (own) return own;
  const event = report.events.find(
    (e) => e.type === "result" && (e.phase === phase || e.phase === null),
  );
  return event?.date ?? null;
}

/* ── Automatic status ──────────────────────────────────────────────────── */

/**
 * What a tracked attempt's own status should become, given a fresh report.
 *
 * Deliberately narrow, and the narrowness is the design. The report describes
 * the *exam*; the attempt's status describes the *person*. Those coincide in
 * exactly one place — "Admit card out" is a fact about the exam that the
 * tracker happens to render as a status — so that is the only transition made
 * automatically.
 *
 * It does not advance anyone to "Appeared" when the report says the exam is
 * over, however tempting the inference. Someone who skipped the exam would
 * find their tracker asserting they sat it, and a tracker that quietly writes
 * things about you that are not true is worse than one that waits to be told.
 *
 * Forward only, and never over a status the person chose. `passed`, `failed`,
 * `withdrawn` and `appeared` are all statements only its owner can make.
 *
 * Returns null when nothing should change, which is the common case.
 */
export function deriveAttemptStatus(
  report: StatusReport,
  current: AttemptStatus,
  confidence: number | null,
): AttemptStatus | null {
  // A hedging answer never moves anyone's row. It is allowed to be wrong on
  // screen, where it is labelled as uncertain; it is not allowed to be wrong
  // in the database, where the label is gone.
  if (!isConfident(confidence)) return null;

  // Statuses only their owner can set. Reaching one ends automatic movement.
  if (current !== "tracking" && current !== "applied") return null;

  const first = phaseOf(report, 1);
  const admitCardOut = first?.admitCardAvailable === true;

  return admitCardOut ? "admit_card" : null;
}

/**
 * Dates worth copying onto the attempt row.
 *
 * Only fills blanks — a date the user typed is never overwritten by a model,
 * and a date the model is no longer sure about does not erase one it gave
 * yesterday. Phase one only: a row has one `exam_date` column, and filling it
 * with the Mains date while the person is preparing for Prelims would make the
 * tracker's soonest-first ordering wrong.
 */
export function deriveAttemptDates(
  report: StatusReport,
  current: { exam_date: string | null; result_date: string | null },
  confidence: number | null,
): { exam_date?: string; result_date?: string } {
  if (!isConfident(confidence)) return {};

  const patch: { exam_date?: string; result_date?: string } = {};

  const examDate = examDateOf(report, 1);
  if (current.exam_date === null && examDate !== null) patch.exam_date = examDate;

  const resultDate = resultDateOf(report, 1);
  if (current.result_date === null && resultDate !== null) patch.result_date = resultDate;

  return patch;
}
