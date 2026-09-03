import { describe, expect, it } from "vitest";

import type { ExamAttempt } from "@/lib/db/queries/attempts";
import type { ExamUpdateSignal } from "@/lib/db/queries/exam-updates";
import type { ExamStatusReport, StatusPhase, StatusReport } from "@/lib/exams/report";
import { subjectKeyFor } from "@/lib/exams/subject";
import {
  categorize,
  categorizeAttempts,
  countByCategory,
  type CategoryInput,
} from "./categorize";

/**
 * Every case is fixed to this date. The rules are about how far away a date
 * is, so a test that used the real clock would pass in September and fail in
 * October — which is precisely the bug class this file exists to catch.
 */
const TODAY = "2026-09-02";

function input(overrides: Partial<CategoryInput> = {}): CategoryInput {
  return {
    status: "tracking",
    stage: null,
    appliedAt: null,
    examDate: null,
    resultDate: null,
    applyDeadline: null,
    report: null,
    updates: [],
    today: TODAY,
    ...overrides,
  };
}

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

function report(overrides: Partial<StatusReport> = {}): ExamStatusReport {
  return {
    subjectKey: "exam:exam-1",
    subjectLabel: "SSC CGL",
    confidence: 90,
    model: "test-model",
    grounded: true,
    sources: [],
    refreshedAt: `${TODAY}T00:00:00.000Z`,
    report: {
      summary: null,
      stage: "exam_scheduled",
      phases: [phase()],
      events: [],
      updates: [],
      recommendations: [],
      confidence: 90,
      ...overrides,
    },
  };
}

function signal(overrides: Partial<ExamUpdateSignal> = {}): ExamUpdateSignal {
  return {
    category: "admit_card",
    title: "SSC CGL 2026 admit card released",
    slug: "ssc-cgl-2026-admit-card",
    publishedDate: "2026-08-28",
    ...overrides,
  };
}

describe("categorize — the candidate's own status wins", () => {
  it("puts a settled attempt in Completed whatever the exam is doing", () => {
    for (const status of ["passed", "failed", "withdrawn"] as const) {
      const result = categorize(
        input({
          status,
          // An admit card is out and the exam is next week — irrelevant, this
          // person is done with it.
          report: report({ phases: [phase({ admitCardAvailable: true })] }),
          examDate: "2026-09-09",
        }),
      );
      expect(result.category).toBe("completed");
    }
  });
});

describe("categorize — Action Required", () => {
  it("flags a downloadable admit card", () => {
    const result = categorize(
      input({
        status: "applied",
        report: report({ phases: [phase({ admitCardAvailable: true })] }),
      }),
    );
    expect(result).toMatchObject({ category: "action", reason: "Admit card available" });
  });

  it("flags an admit card the user set by hand, with no report at all", () => {
    expect(categorize(input({ status: "admit_card" })).category).toBe("action");
  });

  it("flags an application closing inside the window", () => {
    const result = categorize(input({ applyDeadline: "2026-09-08" }));
    expect(result).toMatchObject({
      category: "action",
      reason: "Applications closing",
      sortDate: "2026-09-08",
    });
  });

  it("names the last day as such", () => {
    expect(categorize(input({ applyDeadline: TODAY })).reason).toBe("Applications close today");
  });

  it("prefers the report's closing date over the job's", () => {
    const result = categorize(
      input({
        applyDeadline: "2026-12-01",
        report: report({
          events: [
            {
              type: "application_close",
              phase: null,
              date: "2026-09-05",
              certainty: "high",
              notes: null,
            },
          ],
        }),
      }),
    );
    expect(result).toMatchObject({ category: "action", sortDate: "2026-09-05" });
  });

  it("flags an exam that is days away", () => {
    expect(categorize(input({ status: "applied", examDate: "2026-09-04" }))).toMatchObject({
      category: "action",
      reason: "Exam in days",
    });
  });

  it("flags a freshly declared result so the candidate closes the loop", () => {
    const result = categorize(
      input({
        status: "appeared",
        examDate: "2026-08-01",
        report: report({
          phases: [
            phase({
              status: "result_declared",
              resultAvailable: true,
              resultDate: "2026-08-30",
            }),
          ],
        }),
      }),
    );
    expect(result).toMatchObject({ category: "action", reason: "Result declared" });
  });

  it("does not tell someone their result is out when they never applied", () => {
    // A watch-only row. The result the commission just published belongs to
    // the cycle this person is not in.
    const result = categorize(
      input({
        status: "tracking",
        report: report({
          phases: [
            phase({
              status: "result_declared",
              resultAvailable: true,
              resultDate: "2026-08-30",
            }),
          ],
        }),
      }),
    );
    expect(result.category).not.toBe("action");
  });

  it("does tell them once they have applied", () => {
    const result = categorize(
      input({
        status: "tracking",
        appliedAt: "2026-06-01",
        report: report({
          phases: [
            phase({
              status: "result_declared",
              resultAvailable: true,
              resultDate: "2026-08-30",
            }),
          ],
        }),
      }),
    );
    expect(result).toMatchObject({ category: "action", reason: "Result declared" });
  });

  it("names a two-phase exam's first result for what it is", () => {
    const result = categorize(
      input({
        status: "appeared",
        examDate: "2026-08-01",
        report: report({
          phases: [
            phase({
              status: "result_declared",
              resultAvailable: true,
              resultDate: "2026-08-30",
            }),
            phase({ name: "Mains", status: "not_yet_notified" }),
          ],
        }),
      }),
    );
    expect(result).toMatchObject({ category: "action", reason: "Prelims result declared" });
  });
});

describe("categorize — Upcoming", () => {
  it("does not nag about an application that closes in two months", () => {
    expect(categorize(input({ applyDeadline: "2026-11-01" }))).toMatchObject({
      category: "upcoming",
      reason: "Applications open",
      sortDate: "2026-11-01",
    });
  });

  it("does not nag about a deadline the candidate has already met", () => {
    const result = categorize(
      input({ status: "applied", appliedAt: "2026-08-20", applyDeadline: "2026-09-04" }),
    );
    expect(result).toMatchObject({ category: "upcoming", reason: "Applied" });
  });

  it("leaves a closed application alone rather than calling it urgent", () => {
    expect(categorize(input({ applyDeadline: "2026-08-01" })).category).toBe("upcoming");
  });

  it("keeps an exam scheduled for October out of Action Required", () => {
    expect(categorize(input({ status: "applied", examDate: "2026-10-15" }))).toMatchObject({
      category: "upcoming",
      reason: "Exam scheduled",
      sortDate: "2026-10-15",
    });
  });

  it("says a past exam is awaiting its result rather than scheduled", () => {
    expect(categorize(input({ examDate: "2026-06-07" }))).toMatchObject({
      category: "upcoming",
      reason: "Awaiting result",
    });
  });

  it("reports the next date, not the first one it finds", () => {
    // Prelims in May, Mains in November: this row is waiting on November, and
    // ordering it by May would file it ahead of an exam happening next week.
    const result = categorize(
      input({
        status: "appeared",
        examDate: "2026-05-24",
        report: report({
          phases: [
            phase({ name: "Prelims", status: "exam_completed", examDate: "2026-05-24" }),
            phase({ name: "Mains", status: "exam_scheduled", examDate: "2026-11-20" }),
          ],
        }),
      }),
    );
    expect(result).toMatchObject({ category: "upcoming", sortDate: "2026-11-20" });
  });

  it("keeps someone waiting on a result in Upcoming", () => {
    expect(categorize(input({ status: "appeared", examDate: "2026-08-25" }))).toMatchObject({
      category: "upcoming",
      reason: "Awaiting result",
    });
  });

  it("stays in Upcoming when the first result is old but a second phase is pending", () => {
    const result = categorize(
      input({
        status: "appeared",
        examDate: "2026-01-10",
        report: report({
          phases: [
            phase({
              status: "result_declared",
              resultAvailable: true,
              resultDate: "2026-02-01",
            }),
            phase({ name: "Mains", status: "exam_scheduled", examDate: "2026-11-20" }),
          ],
        }),
      }),
    );
    expect(result.category).toBe("upcoming");
  });
});

describe("categorize — Completed", () => {
  it("retires a result nobody has acted on for months", () => {
    const result = categorize(
      input({
        status: "appeared",
        examDate: "2025-05-10",
        report: report({
          stage: "result_declared",
          phases: [
            phase({
              status: "result_declared",
              resultAvailable: true,
              resultDate: "2025-07-01",
            }),
          ],
        }),
      }),
    );
    expect(result).toMatchObject({ category: "completed", reason: "Result declared" });
  });

  it("retires an exam sat over a year ago with nothing pending", () => {
    expect(categorize(input({ status: "appeared", examDate: "2025-01-15" }))).toMatchObject({
      category: "completed",
      reason: "Exam over",
    });
  });
});

describe("categorize — the updates feed", () => {
  it("promotes an exam whose admit card was announced, when there is no report", () => {
    const result = categorize(input({ status: "applied", updates: [signal()] }));
    expect(result).toMatchObject({ category: "action", reason: "Admit card available" });
  });

  it("ignores a feed entry old enough to be last year's cycle", () => {
    const result = categorize(
      input({ status: "applied", updates: [signal({ publishedDate: "2025-08-28" })] }),
    );
    expect(result.category).toBe("upcoming");
  });

  it("ignores an undated feed entry", () => {
    const result = categorize(
      input({ status: "applied", updates: [signal({ publishedDate: null })] }),
    );
    expect(result.category).toBe("upcoming");
  });

  it("defers to the report, which said the admit card is not out yet", () => {
    const result = categorize(
      input({
        status: "applied",
        report: report({ phases: [phase({ admitCardAvailable: false })] }),
        updates: [signal()],
      }),
    );
    expect(result.category).toBe("upcoming");
  });
});

describe("categorize — without a client clock", () => {
  it("falls back to the group the status alone supports", () => {
    // Every date rule is disabled, so nothing gets promoted on a guess.
    expect(categorize(input({ today: null, applyDeadline: "2026-09-03" })).category).toBe(
      "upcoming",
    );
    expect(categorize(input({ today: null, status: "admit_card" })).category).toBe("action");
    expect(categorize(input({ today: null, status: "passed" })).category).toBe("completed");
  });
});

/* ── The list ──────────────────────────────────────────────────────────── */

function attempt(overrides: Partial<ExamAttempt> = {}): ExamAttempt {
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
    exam: { slug: "ssc-cgl", name: "SSC CGL 2026", short_name: "SSC", organization: null },
    job: null,
    ...overrides,
  };
}

describe("categorizeAttempts", () => {
  it("groups, orders and counts a mixed tracker", () => {
    const attempts: ExamAttempt[] = [
      attempt({ id: "old", status: "appeared", exam_date: "2025-01-15" }),
      attempt({ id: "october", exam_id: "exam-2", status: "applied", exam_date: "2026-10-15" }),
      attempt({ id: "closing-soon", exam_id: "exam-3" }),
      attempt({
        id: "exam-tomorrow",
        exam_id: "exam-4",
        status: "applied",
        exam_date: "2026-09-03",
      }),
    ];

    const items = categorizeAttempts(
      attempts,
      {},
      { "exam:exam-3": [signal({ category: "notification", publishedDate: "2026-08-30" })] },
      TODAY,
      subjectKeyFor,
    );

    // Ordered: Action (soonest first), then Upcoming, then Completed.
    expect(items.map((item) => item.attempt.id)).toEqual([
      "exam-tomorrow",
      "october",
      "closing-soon",
      "old",
    ]);
    expect(countByCategory(items)).toEqual({ action: 1, upcoming: 2, completed: 1 });
  });

  it("reads the application deadline off the linked job", () => {
    const items = categorizeAttempts(
      [
        attempt({
          id: "from-job",
          exam_id: null,
          job_id: "job-1",
          job: {
            slug: "ssc-cgl-2026",
            title: "SSC CGL 2026",
            last_date: "2026-09-05",
            application_start_date: "2026-08-01",
            status: "published",
            organization: null,
          },
        }),
      ],
      {},
      {},
      TODAY,
      subjectKeyFor,
    );

    expect(items[0]).toMatchObject({ category: "action", reason: "Applications closing" });
  });

  it("puts what is still ahead before what is already behind", () => {
    const items = categorizeAttempts(
      [
        // A result declared three weeks ago: real, but nothing expires.
        attempt({
          id: "result-out",
          status: "appeared",
          exam_date: "2026-08-01",
          result_date: "2026-08-12",
        }),
        // An application that shuts on Friday. This is the one to do first.
        attempt({ id: "closes-friday", exam_id: "exam-2", job_id: null, applied_at: null }),
        attempt({ id: "undated", exam_id: "exam-3", status: "applied" }),
      ].map((item) =>
        item.id === "closes-friday"
          ? {
              ...item,
              exam: null,
              job_id: "job-1",
              exam_id: null,
              job: {
                slug: "x",
                title: "X",
                last_date: "2026-09-04",
                application_start_date: "2026-08-01",
                status: "published" as const,
                organization: null,
              },
            }
          : item,
      ),
      {},
      {},
      TODAY,
      subjectKeyFor,
    );

    expect(items.map((item) => item.attempt.id)).toEqual([
      "closes-friday",
      "result-out",
      "undated",
    ]);
  });

  it("sorts Completed newest first — the thing that just ended is the one worth seeing", () => {
    const items = categorizeAttempts(
      [
        attempt({ id: "older", status: "passed", result_date: "2024-03-01" }),
        attempt({
          id: "newer",
          exam_id: "exam-2",
          status: "passed",
          result_date: "2026-03-01",
        }),
      ],
      {},
      {},
      TODAY,
      subjectKeyFor,
    );

    expect(items.map((item) => item.attempt.id)).toEqual(["newer", "older"]);
  });
});
