import { describe, expect, it } from "vitest";

import {
  admitCardDateOf,
  applicationDeadlineOf,
  CONFIDENCE_FLOOR,
  deriveAttemptDates,
  deriveAttemptStatus,
  examDateOf,
  hasSecondPhase,
  isStale,
  latestReport,
  phaseOf,
  progressOf,
  type ExamStatusReport,
  type StatusPhase,
  type StatusReport,
} from "./report";

function phase(overrides: Partial<StatusPhase> = {}): StatusPhase {
  return {
    name: "Tier 1",
    status: "exam_scheduled",
    admitCardAvailable: false,
    admitCardLink: null,
    examDate: null,
    examDetails: null,
    resultAvailable: false,
    resultLink: null,
    resultDate: null,
    ...overrides,
  };
}

function report(overrides: Partial<StatusReport> = {}): StatusReport {
  return {
    summary: null,
    stage: "exam_scheduled",
    phases: [phase()],
    events: [],
    updates: [],
    recommendations: [],
    confidence: 90,
    ...overrides,
  };
}

describe("progressOf", () => {
  it("never reads as zero, which looks broken rather than early", () => {
    expect(progressOf(report({ stage: "not_yet_notified" }))).toBeGreaterThan(0);
  });

  it("ends at 100 when the result is out", () => {
    expect(progressOf(report({ stage: "result_declared" }))).toBe(100);
  });

  it("increases monotonically through the stages", () => {
    const notified = progressOf(report({ stage: "registration_open" }));
    const scheduled = progressOf(report({ stage: "exam_scheduled" }));
    const admit = progressOf(report({ stage: "admit_card_available" }));
    expect(notified).toBeLessThan(scheduled);
    expect(scheduled).toBeLessThan(admit);
  });
});

describe("phases", () => {
  it("reports a single-stage exam as having no second phase", () => {
    expect(hasSecondPhase(report())).toBe(false);
    expect(phaseOf(report(), 2)).toBeNull();
  });

  it("recognises a genuine second stage", () => {
    const two = report({ phases: [phase(), phase({ name: "Tier 2" })] });
    expect(hasSecondPhase(two)).toBe(true);
    expect(phaseOf(two, 2)?.name).toBe("Tier 2");
  });

  it("does not count a stage explicitly marked not applicable", () => {
    const two = report({ phases: [phase(), phase({ status: "not_applicable" })] });
    expect(hasSecondPhase(two)).toBe(false);
  });
});

describe("examDateOf", () => {
  it("prefers the phase's own scheduled date", () => {
    const r = report({
      phases: [phase({ examDate: "2026-03-10" })],
      events: [
        { type: "exam_date", phase: 1, date: "2026-04-01", certainty: "low", notes: null },
      ],
    });
    expect(examDateOf(r, 1)).toBe("2026-03-10");
  });

  it("falls back to a predicted event when nothing is scheduled", () => {
    const r = report({
      events: [
        { type: "exam_date", phase: null, date: "2026-04-01", certainty: "low", notes: null },
      ],
    });
    expect(examDateOf(r, 1)).toBe("2026-04-01");
  });
});

describe("admitCardDateOf", () => {
  it("reads the release date from the dated events, where the phase has none", () => {
    const r = report({
      events: [
        { type: "admit_card", phase: 1, date: "2026-09-27", certainty: "high", notes: null },
      ],
    });
    expect(admitCardDateOf(r, 1)).toBe("2026-09-27");
  });

  it("gives an unphased admit card to the first phase only", () => {
    const r = report({
      phases: [phase(), phase({ name: "Tier 2" })],
      events: [
        { type: "admit_card", phase: null, date: "2026-09-27", certainty: "high", notes: null },
      ],
    });
    expect(admitCardDateOf(r, 1)).toBe("2026-09-27");
    expect(admitCardDateOf(r, 2)).toBeNull();
  });
});

describe("applicationDeadlineOf", () => {
  const today = "2026-09-22";
  const cgl = report({
    events: [
      { type: "admit_card", phase: 1, date: "2026-09-27", certainty: "high", notes: null },
      { type: "exam_date", phase: 1, date: "2026-09-30", certainty: "high", notes: null },
    ],
  });

  it("drops a notification date that falls after this cycle's admit card", () => {
    expect(applicationDeadlineOf(cgl, "2027-06-02", today)).toBeNull();
  });

  it("keeps a notification date that closes before the admit card", () => {
    expect(applicationDeadlineOf(cgl, "2026-09-25", today)).toBe("2026-09-25");
  });

  it("does not let last cycle's dates hide an open deadline", () => {
    const stale = report({
      events: [
        { type: "exam_date", phase: 1, date: "2025-09-30", certainty: "high", notes: null },
      ],
    });
    expect(applicationDeadlineOf(stale, "2026-10-15", today)).toBe("2026-10-15");
  });

  it("prefers the report's own closing date", () => {
    const r = report({
      events: [
        {
          type: "application_close",
          phase: null,
          date: "2026-06-25",
          certainty: "high",
          notes: null,
        },
      ],
    });
    expect(applicationDeadlineOf(r, "2027-06-02", today)).toBe("2026-06-25");
  });
});

describe("latestReport", () => {
  const stored = (refreshedAt: string): ExamStatusReport => ({
    subjectKey: "job:1",
    subjectLabel: "SSC CGL",
    report: report(),
    confidence: 90,
    model: "test-model",
    grounded: true,
    sources: [],
    refreshedAt,
  });

  it("keeps the panel's own answer while it is the newer one", () => {
    const own = stored("2026-09-22T09:00:05.000Z");
    expect(latestReport(own, stored("2026-09-22T09:00:04.000Z"))).toBe(own);
  });

  it("takes the server's copy once it has moved on", () => {
    const server = stored("2026-09-22T10:30:00.000Z");
    expect(latestReport(stored("2026-09-22T09:00:05.000Z"), server)).toBe(server);
  });

  it("uses whichever exists, and never an unreadable timestamp", () => {
    const good = stored("2026-09-22T09:00:00.000Z");
    expect(latestReport(null, good)).toBe(good);
    expect(latestReport(good, null)).toBe(good);
    expect(latestReport(stored("not a date"), good)).toBe(good);
    expect(latestReport(null, null)).toBeNull();
  });
});

describe("isStale", () => {
  const now = new Date("2026-08-27T12:00:00Z");

  it("keeps a confident answer for a day", () => {
    expect(isStale("2026-08-27T00:00:00Z", 90, now)).toBe(false);
    expect(isStale("2026-08-26T00:00:00Z", 90, now)).toBe(true);
  });

  it("expires an uncertain answer in hours, so retrying it is cheap", () => {
    expect(isStale("2026-08-27T11:00:00Z", 40, now)).toBe(false);
    expect(isStale("2026-08-27T00:00:00Z", 40, now)).toBe(true);
  });

  it("treats an unreadable timestamp as stale rather than as fresh", () => {
    expect(isStale("not a date", 90, now)).toBe(true);
  });
});

/**
 * The rules that decide whether a model gets to write to somebody's tracker.
 *
 * These are the assertions worth having in this file. Everything else here is
 * display; this is the part that changes stored data on a person's behalf, and
 * getting it wrong means the app quietly asserting something untrue about them.
 */
describe("deriveAttemptStatus", () => {
  const admitCardOut = report({
    stage: "admit_card_available",
    phases: [phase({ admitCardAvailable: true })],
  });

  it("moves a tracked or applied row to 'admit card out'", () => {
    expect(deriveAttemptStatus(admitCardOut, "tracking", 90)).toBe("admit_card");
    expect(deriveAttemptStatus(admitCardOut, "applied", 90)).toBe("admit_card");
  });

  it("does nothing when the admit card is not actually out", () => {
    expect(deriveAttemptStatus(report(), "tracking", 90)).toBeNull();
  });

  it("never claims someone appeared for an exam that has happened", () => {
    const over = report({
      stage: "result_declared",
      phases: [phase({ status: "result_declared", resultAvailable: true })],
    });
    expect(deriveAttemptStatus(over, "tracking", 95)).toBeNull();
    expect(deriveAttemptStatus(over, "applied", 95)).toBeNull();
  });

  it("never moves a status its owner chose", () => {
    for (const owned of ["appeared", "passed", "failed", "withdrawn", "admit_card"] as const) {
      expect(deriveAttemptStatus(admitCardOut, owned, 95)).toBeNull();
    }
  });

  it("refuses to act on a low-confidence answer", () => {
    expect(deriveAttemptStatus(admitCardOut, "tracking", CONFIDENCE_FLOOR - 1)).toBeNull();
    expect(deriveAttemptStatus(admitCardOut, "tracking", CONFIDENCE_FLOOR)).toBe("admit_card");
  });
});

describe("deriveAttemptDates", () => {
  const dated = report({
    phases: [phase({ examDate: "2026-03-10", resultDate: "2026-05-01" })],
  });

  it("fills blanks", () => {
    expect(deriveAttemptDates(dated, { exam_date: null, result_date: null }, 90)).toEqual({
      exam_date: "2026-03-10",
      result_date: "2026-05-01",
    });
  });

  it("never overwrites a date its owner typed", () => {
    expect(
      deriveAttemptDates(dated, { exam_date: "2026-01-01", result_date: null }, 90),
    ).toEqual({ result_date: "2026-05-01" });
  });

  it("writes nothing from a low-confidence answer", () => {
    expect(deriveAttemptDates(dated, { exam_date: null, result_date: null }, 30)).toEqual({});
  });

  it("takes the first phase's dates, not the second's", () => {
    const twoPhases = report({
      phases: [
        phase({ examDate: "2026-03-10" }),
        phase({ name: "Tier 2", examDate: "2026-09-10" }),
      ],
    });
    expect(
      deriveAttemptDates(twoPhases, { exam_date: null, result_date: null }, 90).exam_date,
    ).toBe("2026-03-10");
  });
});
