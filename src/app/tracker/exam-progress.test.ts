import { describe, expect, it } from "vitest";

import type { ExamAttempt } from "@/lib/db/queries/attempts";
import type { ExamStatusReport, StatusPhase, StatusReport } from "@/lib/exams/report";
import { computeNextEvent, computeStages, isStage2 } from "./exam-progress";

function mockAttempt(overrides: Partial<ExamAttempt> = {}): ExamAttempt {
  return {
    id: "attempt-1",
    exam_id: "exam-1",
    custom_name: null,
    stage: null,
    status: "tracking",
    applied_at: null,
    exam_date: null,
    result_date: null,
    roll_number: null,
    score: null,
    notes: null,
    job_id: null,
    exam: {
      slug: "upsc-cse",
      name: "UPSC Civil Services",
      short_name: "UPSC CSE",
      organization: null,
    },
    job: null,
    ...overrides,
  };
}

function mockPhase(overrides: Partial<StatusPhase> = {}): StatusPhase {
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

function mockReport(overrides: Partial<StatusReport> = {}): ExamStatusReport {
  return {
    subjectKey: "ssc-cgl",
    subjectLabel: "SSC CGL",
    confidence: 90,
    model: "test-model",
    grounded: true,
    sources: [],
    refreshedAt: new Date().toISOString(),
    report: {
      summary: null,
      stage: "exam_scheduled",
      phases: [mockPhase()],
      events: [],
      updates: [],
      recommendations: [],
      confidence: 90,
      ...overrides,
    },
  };
}

describe("isStage2", () => {
  it("returns true for Mains / Tier 2 variants", () => {
    expect(isStage2("Mains")).toBe(true);
    expect(isStage2("Civil Services (Main) Examination")).toBe(true);
    expect(isStage2("Tier 2")).toBe(true);
    expect(isStage2("Tier II")).toBe(true);
    expect(isStage2("Phase 2")).toBe(true);
  });

  it("returns false for Prelims / Tier 1 / null", () => {
    expect(isStage2(null)).toBe(false);
    expect(isStage2(undefined)).toBe(false);
    expect(isStage2("")).toBe(false);
    expect(isStage2("Prelims")).toBe(false);
    expect(isStage2("Tier 1")).toBe(false);
  });
});

describe("computeStages", () => {
  it("defaults to 5 stages when no report is passed", () => {
    const stages = computeStages("tracking", null, null);
    expect(stages).toHaveLength(5);
    expect(stages.map((s) => s.shortLabel)).toEqual([
      "Apply",
      "Admit",
      "Prelims",
      "Mains",
      "Result",
    ]);
  });

  it("marks Apply as current when status is tracking without applied_at", () => {
    const stages = computeStages("tracking", null, null);
    expect(stages[0]?.state).toBe("current");
    expect(stages[1]?.state).toBe("upcoming");
    expect(stages[2]?.state).toBe("upcoming");
  });

  it("marks Apply as completed and Admit as current when status is applied", () => {
    const stages = computeStages("applied", null, null);
    expect(stages[0]?.state).toBe("completed");
    expect(stages[1]?.state).toBe("current");
    expect(stages[2]?.state).toBe("upcoming");
  });

  it("marks Apply as completed when tracking with applied_at date", () => {
    const stages = computeStages(
      "tracking",
      { applied_at: "2026-08-01", stage: null, exam_date: null, result_date: null },
      null,
    );
    expect(stages[0]?.state).toBe("completed");
    expect(stages[1]?.state).toBe("current");
  });

  it("marks Admit as completed and Exam as current when status is admit_card", () => {
    const stages = computeStages("admit_card", null, null);
    expect(stages[0]?.state).toBe("completed");
    expect(stages[1]?.state).toBe("completed");
    expect(stages[2]?.state).toBe("current");
  });

  // Bug (e) fix: appeared for Prelims keeps Prelims as "current" (waiting for result)
  it("keeps Prelims as current when appeared without stage hint (2-phase default)", () => {
    const stages = computeStages("appeared", null, null);
    expect(stages[0]?.state).toBe("completed"); // Apply
    expect(stages[1]?.state).toBe("completed"); // Admit
    expect(stages[2]?.state).toBe("current"); // Prelims — sat for it, waiting for result
    expect(stages[3]?.state).toBe("upcoming"); // Mains
    expect(stages[4]?.state).toBe("upcoming"); // Result
  });

  // Bug (e) fix: appeared for Mains advances to Final Result
  it("marks Final Result as current when appeared for Mains", () => {
    const twoPhasesReport = mockReport({
      phases: [mockPhase({ name: "Prelims" }), mockPhase({ name: "Mains" })],
    });
    const stages = computeStages(
      "appeared",
      { stage: "Mains", applied_at: null, exam_date: null, result_date: null },
      twoPhasesReport,
    );
    expect(stages[0]?.state).toBe("completed"); // Apply
    expect(stages[1]?.state).toBe("completed"); // Admit
    expect(stages[2]?.state).toBe("completed"); // Prelims
    expect(stages[3]?.state).toBe("completed"); // Mains
    expect(stages[4]?.state).toBe("current"); // Final Result
  });

  it("marks phase 2 as current when passed without stage hint (defaults to passed-prelims on 2-phase)", () => {
    // With no report and no stage, defaults to twoPhases=true, userAtPhase2=false
    // So "passed" = passed prelims → Phase 2 becomes current
    const stages = computeStages("passed", null, null);
    expect(stages[0]?.state).toBe("completed"); // Apply
    expect(stages[1]?.state).toBe("completed"); // Admit
    expect(stages[2]?.state).toBe("completed"); // Prelims
    expect(stages[3]?.state).toBe("current"); // Mains
    expect(stages[4]?.state).toBe("upcoming"); // Result
  });

  it("marks phase 2 as current when user passed prelims of a two-phase exam", () => {
    const twoPhasesReport = mockReport({
      phases: [mockPhase({ name: "Tier 1" }), mockPhase({ name: "Tier 2" })],
    });
    const stages = computeStages(
      "passed",
      { stage: "Prelims", applied_at: null, exam_date: null, result_date: null },
      twoPhasesReport,
    );
    expect(stages[0]?.state).toBe("completed"); // Apply
    expect(stages[1]?.state).toBe("completed"); // Admit
    expect(stages[2]?.state).toBe("completed"); // Tier 1
    expect(stages[3]?.state).toBe("current"); // Tier 2
    expect(stages[4]?.state).toBe("upcoming"); // Result
  });

  it("builds 4 stages for single-phase exams", () => {
    const singlePhaseReport = mockReport({
      phases: [mockPhase({ name: "Computer Based Test" })],
    });
    const stages = computeStages("applied", null, singlePhaseReport);
    expect(stages).toHaveLength(4);
    expect(stages.map((s) => s.shortLabel)).toEqual(["Apply", "Admit", "CBT", "Result"]);
  });

  it("includes stage details and links when present in report and attempt", () => {
    const reportWithLinks = mockReport({
      phases: [
        mockPhase({
          name: "Tier 1",
          admitCardAvailable: true,
          admitCardLink: "https://ssc.gov.in/admit-card",
          examDate: "2026-10-15",
          resultAvailable: true,
          resultLink: "https://ssc.gov.in/results",
        }),
      ],
    });
    const stages = computeStages(
      "admit_card",
      { applied_at: "2026-08-10", exam_date: "2026-10-15", result_date: null, stage: null },
      reportWithLinks,
    );
    expect(stages[0]?.detail).toContain("Applied");
    expect(stages[1]?.detail).toBe("Out now");
    expect(stages[1]?.link).toBe("https://ssc.gov.in/admit-card");
    expect(stages[2]?.detail).toContain("15 Oct 2026");
  });

  // Bug (a) fix: Final Result uses phase2 data, not phase1
  it("uses phase2 result date for Final Result on 2-phase exam", () => {
    const twoPhasesReport = mockReport({
      phases: [
        mockPhase({
          name: "Prelims",
          resultAvailable: true,
          resultDate: "2026-06-15",
          resultLink: "https://upsc.gov.in/prelims-result",
        }),
        mockPhase({
          name: "Mains",
          resultAvailable: false,
          resultDate: "2027-04-15",
          resultLink: null,
        }),
      ],
    });
    const stages = computeStages("appeared", null, twoPhasesReport);
    // Final Result (last stage) should show phase2 result date, not phase1
    const resultStage = stages[stages.length - 1];
    expect(resultStage?.detail).toContain("15 Apr 2027"); // Phase 2 date, not June 2026
    expect(resultStage?.link).toBeNull(); // Phase 2 has no link yet
  });

  // Bug (c) fix: Phase 1 stage gets its own result link
  it("shows phase1 result link on phase1 stage card for 2-phase exam", () => {
    const twoPhasesReport = mockReport({
      phases: [
        mockPhase({
          name: "Prelims",
          resultAvailable: true,
          resultLink: "https://upsc.gov.in/prelims-result",
          resultDate: "2026-06-15",
        }),
        mockPhase({
          name: "Mains",
          resultAvailable: false,
          resultLink: null,
          resultDate: "2027-04-15",
        }),
      ],
    });
    const stages = computeStages(
      "passed",
      { stage: "Prelims", applied_at: null, exam_date: null, result_date: null },
      twoPhasesReport,
    );
    // Phase 1 stage (index 2) should carry the prelims result link
    expect(stages[2]?.link).toBe("https://upsc.gov.in/prelims-result");
    // Final Result stage (index 4) should carry null (no mains result yet)
    expect(stages[4]?.link).toBeNull();
  });

  // Bug (b) fix: attempt.exam_date assigned to correct phase
  it("does not assign Mains exam_date to Prelims stage", () => {
    const twoPhasesReport = mockReport({
      phases: [
        mockPhase({ name: "Prelims", examDate: "2026-05-24" }),
        mockPhase({ name: "Mains", examDate: "2026-09-18" }),
      ],
    });
    const stages = computeStages(
      "admit_card",
      { stage: "Mains", applied_at: null, exam_date: "2026-09-18", result_date: null },
      twoPhasesReport,
    );
    // Phase 1 (Prelims) detail should show 24 May, not 18 Sep
    expect(stages[2]?.detail).toContain("24 May 2026");
    // Phase 2 (Mains) detail should show 18 Sept
    expect(stages[3]?.detail).toContain("Sept 2026");
  });

  // Progress bar auto-advancement from report data
  it("advances progress bar based on report phase statuses even when user is just tracking", () => {
    const report = mockReport({
      phases: [
        mockPhase({
          name: "Prelims",
          status: "result_declared",
          resultAvailable: true,
          resultDate: "2026-06-15",
        }),
        mockPhase({
          name: "Mains",
          status: "exam_completed",
          examDate: "2026-08-21",
        }),
      ],
    });
    // User has status "tracking" but report shows Mains exam is completed
    const stages = computeStages("tracking", null, report);
    // reportIndex = 4 (exam_completed on phase 2), userIndex = 0
    // Math.max(0, 4) = 4 → Apply/Admit/Prelims/Mains all completed, Result current
    expect(stages[0]?.state).toBe("completed"); // Apply
    expect(stages[1]?.state).toBe("completed"); // Admit
    expect(stages[2]?.state).toBe("completed"); // Prelims
    expect(stages[3]?.state).toBe("completed"); // Mains
    expect(stages[4]?.state).toBe("current"); // Result
  });
});

describe("computeNextEvent", () => {
  const today = "2026-09-01";

  it("falls back to the job's closing date when no report has one", () => {
    const attempt = mockAttempt({
      status: "tracking",
      exam_id: null,
      job_id: "job-1",
      job: {
        slug: "ssc-cgl-2026",
        title: "SSC CGL 2026",
        last_date: "2026-09-04",
        application_start_date: "2026-08-01",
        status: "published",
        organization: null,
      },
    });

    const next = computeNextEvent("tracking", attempt, null, today);

    expect(next?.title).toBe("Application Deadline");
    expect(next?.date).toContain("4 Sept 2026");
    expect(next?.date).toContain("In 3 days");
    expect(next?.tone).toBe("warn");
  });

  it("returns Result as next milestone when exam date is in the past", () => {
    const pastExamReport = mockReport({
      phases: [
        mockPhase({
          name: "Prelims",
          examDate: "2026-05-24", // Past date
          resultDate: "2026-10-15", // Future date
          resultAvailable: false,
        }),
      ],
    });

    const attempt = mockAttempt({ status: "admit_card" });
    const next = computeNextEvent("admit_card", attempt, pastExamReport, today);

    expect(next?.title).toBe("Result Declaration");
    expect(next?.subtitle).toContain("Exam completed");
    expect(next?.date).toContain("15 Oct 2026");
  });

  it("returns Result as next milestone when status is appeared", () => {
    const report = mockReport({
      phases: [
        mockPhase({
          name: "Prelims",
          resultDate: "2026-10-15",
          resultAvailable: false,
        }),
      ],
    });

    const attempt = mockAttempt({ status: "appeared" });
    const next = computeNextEvent("appeared", attempt, report, today);

    expect(next?.title).toBe("Result Declaration");
    expect(next?.date).toContain("15 Oct 2026");
  });

  it("returns Result Declared when result is already available", () => {
    const report = mockReport({
      phases: [
        mockPhase({
          name: "Prelims",
          resultAvailable: true,
          resultLink: "https://upsc.gov.in/result.pdf",
        }),
      ],
    });

    const attempt = mockAttempt({ status: "appeared" });
    const next = computeNextEvent("appeared", attempt, report, today);

    expect(next?.title).toBe("Result Declared");
    expect(next?.date).toBe("Available now");
    expect(next?.link?.href).toBe("https://upsc.gov.in/result.pdf");
  });

  it("advances to Exam when admit card release date is in the past for applied status", () => {
    const report = mockReport({
      phases: [
        mockPhase({
          name: "Prelims",
          examDate: "2026-10-20", // Future
        }),
      ],
      events: [
        {
          type: "admit_card",
          phase: 1,
          date: "2026-08-15", // Past
          certainty: "high",
          notes: null,
        },
      ],
    });

    const attempt = mockAttempt({ status: "applied" });
    const next = computeNextEvent("applied", attempt, report, today);

    expect(next?.title).toBe("Prelims Examination");
    expect(next?.date).toContain("20 Oct 2026");
  });

  it("advances to Phase 2 Result when passed prelims and phase 2 exam is in the past", () => {
    const twoPhasesReport = mockReport({
      phases: [
        mockPhase({
          name: "Prelims",
          resultAvailable: true,
        }),
        mockPhase({
          name: "Mains",
          examDate: "2026-08-21", // Past
          resultDate: "2026-11-15", // Future
          resultAvailable: false,
        }),
      ],
    });

    const attempt = mockAttempt({ status: "passed", stage: "Prelims" });
    const next = computeNextEvent("passed", attempt, twoPhasesReport, today);
    expect(next?.title).toBe("Mains Result Declaration");
    expect(next?.subtitle).toContain("Mains exam completed");
    expect(next?.date).toContain("15 Nov 2026");
  });

  it("checks both Prelims and Mains: advances to Mains Exam when tracking and Prelims is completed", () => {
    const twoPhasesReport = mockReport({
      phases: [
        mockPhase({
          name: "Prelims",
          status: "result_declared",
          resultAvailable: true,
          resultDate: "2026-06-15", // Past
        }),
        mockPhase({
          name: "Mains",
          status: "exam_scheduled",
          examDate: "2026-10-18", // Future
          resultDate: "2027-01-15",
        }),
      ],
    });

    const attempt = mockAttempt({ status: "tracking" });
    const next = computeNextEvent("tracking", attempt, twoPhasesReport, today);

    expect(next?.title).toBe("Mains Examination");
    expect(next?.subtitle).toContain("Prepare for Mains");
    expect(next?.date).toContain("18 Oct 2026");
  });

  it("checks both Prelims and Mains: advances to Mains Result when tracking and Mains exam is past", () => {
    const twoPhasesReport = mockReport({
      phases: [
        mockPhase({
          name: "Prelims",
          status: "result_declared",
          resultAvailable: true,
          resultDate: "2026-06-15", // Past
        }),
        mockPhase({
          name: "Mains",
          status: "exam_completed",
          examDate: "2026-08-21", // Past
          resultDate: "2026-11-15", // Future
          resultAvailable: false,
        }),
      ],
    });

    const attempt = mockAttempt({ status: "tracking" });
    const next = computeNextEvent("tracking", attempt, twoPhasesReport, today);

    expect(next?.title).toBe("Mains Result Declaration");
    expect(next?.subtitle).toContain("Mains exam completed");
    expect(next?.date).toContain("15 Nov 2026");
  });
});
