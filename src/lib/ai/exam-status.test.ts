import { describe, expect, it } from "vitest";

import { asIsoDate, asOfficialLink, extractJson, parseStatusReport } from "./status-parse";

/**
 * The parser is the load-bearing part of this feature.
 *
 * Everything downstream — the panel, the automatic status advance, the stored
 * row — trusts that what comes out of here is canonical and sane. The old app
 * had no equivalent: it stored whatever the model emitted and made every reader
 * cope, which is how a card grew to 1,321 lines and still told people an admit
 * card was out three months before it was.
 *
 * So these cases are not hypothetical shapes. They are the ones that arrived.
 */

const NOW = new Date("2026-08-27T00:00:00Z");

/** The shape the current prompt asks for, filled in. */
function wellFormed(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    summary: "Applications are open until September.",
    current_status: "registration_open",
    phases: {
      phase1: {
        name: "Tier 1",
        status: "registration_open",
        admit_card_available: false,
        admit_card_link: null,
        exam_date: "2026-11-15",
        exam_details: "Two shifts",
        result_available: false,
        result_link: null,
        result_date: null,
      },
      phase2: { status: "not_applicable" },
    },
    predicted_events: [
      {
        event_type: "application_close",
        phase: 1,
        predicted_date: "2026-09-20",
        confidence: "high",
        notes: "From the notification PDF",
      },
    ],
    latest_updates: ["Notification published on 20 August."],
    recommendations: ["Apply before the fee window closes."],
    confidence_score: 88,
    ...overrides,
  });
}

describe("extractJson", () => {
  it("survives a markdown fence", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("survives a preamble the prompt asked it not to write", () => {
    expect(extractJson('Sure! Here is the JSON:\n{"a":1}\nHope that helps.')).toBe('{"a":1}');
  });

  it("returns null when there is no object at all", () => {
    expect(extractJson("I could not find anything about this exam.")).toBeNull();
  });
});

describe("asIsoDate", () => {
  it("accepts ISO and month-name forms", () => {
    expect(asIsoDate("2026-03-10")).toBe("2026-03-10");
    expect(asIsoDate("2026-03-10T00:00:00Z")).toBe("2026-03-10");
    expect(asIsoDate("15 March 2026")).toBe("2026-03-15");
    expect(asIsoDate("Mar 15, 2026")).toBe("2026-03-15");
  });

  /**
   * The single most consequential decision in this file. "03/04/2026" is 3
   * April to an Indian conducting body and 4 March to an American source, and
   * there is no way to tell which one the model read. A wrong exam date is the
   * one error this product cannot afford, so an ambiguous date becomes no date.
   */
  it("refuses ambiguous numeric dates rather than guessing", () => {
    expect(asIsoDate("03/04/2026")).toBeNull();
    expect(asIsoDate("3-4-2026")).toBeNull();
  });

  it("rejects dates that do not exist", () => {
    expect(asIsoDate("2026-02-31")).toBeNull();
    expect(asIsoDate("2026-13-01")).toBeNull();
  });

  it("treats the model's null-ish strings as absent", () => {
    expect(asIsoDate("null")).toBeNull();
    expect(asIsoDate("N/A")).toBeNull();
    expect(asIsoDate("")).toBeNull();
  });
});

describe("asOfficialLink", () => {
  it("keeps a conducting body's own URL", () => {
    expect(asOfficialLink("https://ssc.gov.in/admit-card")).toBe(
      "https://ssc.gov.in/admit-card",
    );
  });

  it("drops aggregators and chat groups, whatever the model says about them", () => {
    expect(asOfficialLink("https://www.freejobalert.com/ssc-cgl/")).toBeNull();
    expect(asOfficialLink("https://chat.whatsapp.com/abc")).toBeNull();
    expect(asOfficialLink("https://t.me/sscupdates")).toBeNull();
  });

  it("drops anything that is not a web URL", () => {
    expect(asOfficialLink("javascript:alert(1)")).toBeNull();
    expect(asOfficialLink("Download from the official website")).toBeNull();
  });
});

describe("parseStatusReport", () => {
  it("reads the shape the prompt asks for", () => {
    const parsed = parseStatusReport(wellFormed(), NOW);

    expect(parsed).not.toBeNull();
    expect(parsed?.stage).toBe("registration_open");
    expect(parsed?.summary).toContain("Applications are open");
    expect(parsed?.confidence).toBe(88);
    expect(parsed?.phases).toHaveLength(1);
    expect(parsed?.phases[0]?.name).toBe("Tier 1");
  });

  it("keeps a real second stage and drops a not-applicable one", () => {
    const single = parseStatusReport(wellFormed(), NOW);
    expect(single?.phases).toHaveLength(1);

    const twoStage = parseStatusReport(
      wellFormed({
        phases: {
          phase1: { name: "Prelims", status: "exam_completed" },
          phase2: { name: "Mains", status: "exam_scheduled", exam_date: "2027-01-10" },
        },
      }),
      NOW,
    );
    expect(twoStage?.phases).toHaveLength(2);
    expect(twoStage?.phases[1]?.name).toBe("Mains");
  });

  /* ── The failures this parser exists to stop ───────────────────────────── */

  it("treats a non-boolean admit-card answer as false", () => {
    // Verbatim from the old project's logs. Truthy, and completely wrong.
    const parsed = parseStatusReport(
      wellFormed({
        phases: { phase1: { name: "Tier 1", admit_card_available: "February 7 expected" } },
      }),
      NOW,
    );
    expect(parsed?.phases[0]?.admitCardAvailable).toBe(false);
  });

  it("refuses an admit card claimed for an exam months away", () => {
    const parsed = parseStatusReport(
      wellFormed({
        current_status: "admit_card_available",
        phases: {
          phase1: {
            name: "Tier 1",
            status: "admit_card_available",
            admit_card_available: true,
            admit_card_link: "https://ssc.gov.in/admit",
            exam_date: "2026-12-25",
          },
        },
      }),
      NOW,
    );

    expect(parsed?.phases[0]?.admitCardAvailable).toBe(false);
    // And the link goes with it: a download for a document that is not out is
    // a link to a 404 at the moment somebody is most anxious.
    expect(parsed?.phases[0]?.admitCardLink).toBeNull();
    // And the headline follows, rather than contradicting the section below it.
    expect(parsed?.stage).not.toBe("admit_card_available");
  });

  it("refuses a result 'declared' on a future date", () => {
    const parsed = parseStatusReport(
      wellFormed({
        current_status: "result_declared",
        phases: {
          phase1: {
            name: "Tier 1",
            status: "result_declared",
            result_available: true,
            result_date: "2026-12-01",
            result_link: "https://ssc.gov.in/result",
          },
        },
      }),
      NOW,
    );

    expect(parsed?.phases[0]?.resultAvailable).toBe(false);
    expect(parsed?.stage).toBe("exam_completed");
  });

  it("raises the headline when the evidence is ahead of it", () => {
    const parsed = parseStatusReport(
      wellFormed({
        current_status: "registration_open",
        phases: {
          phase1: {
            name: "Tier 1",
            admit_card_available: true,
            admit_card_link: "https://ssc.gov.in/admit",
            exam_date: "2026-09-05",
          },
        },
      }),
      NOW,
    );

    expect(parsed?.phases[0]?.admitCardAvailable).toBe(true);
    expect(parsed?.stage).toBe("admit_card_available");
  });

  /* ── Shapes from the old project ──────────────────────────────────────── */

  it("reads the older phase_1 / phase_2 spelling", () => {
    const parsed = parseStatusReport(
      JSON.stringify({
        summary: "Prelims done.",
        current_status: "exam_completed",
        phase_1: { name: "Prelims", status: "exam_completed", exam_date: "2026-06-01" },
        phase_2: { name: "Mains", status: "exam_scheduled", exam_date: "2026-10-01" },
        confidence_score: 80,
      }),
      NOW,
    );

    expect(parsed?.phases).toHaveLength(2);
    expect(parsed?.phases[0]?.name).toBe("Prelims");
    expect(parsed?.phases[1]?.name).toBe("Mains");
  });

  it("folds root-level fields in as the first phase", () => {
    const parsed = parseStatusReport(
      JSON.stringify({
        summary: "Admit card is out.",
        current_status: "admit_card_available",
        admit_card_available: true,
        admit_card_link: "https://ssc.gov.in/admit",
        exam_dates: "2026-09-01",
        confidence_score: 85,
      }),
      NOW,
    );

    expect(parsed?.phases[0]?.admitCardAvailable).toBe(true);
    expect(parsed?.phases[0]?.admitCardLink).toBe("https://ssc.gov.in/admit");
    expect(parsed?.phases[0]?.examDate).toBe("2026-09-01");
  });

  it("canonicalises event-type aliases and drops undated events", () => {
    const parsed = parseStatusReport(
      wellFormed({
        predicted_events: [
          { event_type: "exam", predicted_date: "2026-11-15" },
          { event_type: "Result Date", predicted_date: "2027-01-05" },
          { event_type: "exam_date", predicted_date: null },
          { event_type: "nonsense", predicted_date: "2026-10-01" },
        ],
      }),
      NOW,
    );

    const types = parsed?.events.map((e) => e.type) ?? [];
    expect(types).toContain("exam_date");
    expect(types).toContain("result");
    expect(parsed?.events.every((e) => e.date !== "")).toBe(true);
    expect(types).not.toContain("nonsense");
  });

  it("adds the dates the model gave structurally but did not repeat as events", () => {
    const parsed = parseStatusReport(wellFormed({ predicted_events: [] }), NOW);

    // phase1.exam_date is 2026-11-15 in the fixture.
    expect(parsed?.events.some((e) => e.type === "exam_date" && e.date === "2026-11-15")).toBe(
      true,
    );
  });

  /* ── Junk ─────────────────────────────────────────────────────────────── */

  it("returns null for something that is not JSON at all", () => {
    expect(parseStatusReport("I was unable to find this exam.", NOW)).toBeNull();
  });

  it("returns null for an object with nothing in it worth showing", () => {
    expect(parseStatusReport("{}", NOW)).toBeNull();
  });

  it("clamps a confidence score to 0–100, since the column is constrained", () => {
    expect(parseStatusReport(wellFormed({ confidence_score: 140 }), NOW)?.confidence).toBe(100);
    expect(parseStatusReport(wellFormed({ confidence_score: -5 }), NOW)?.confidence).toBe(0);
    expect(
      parseStatusReport(wellFormed({ confidence_score: "high" }), NOW)?.confidence,
    ).toBeNull();
  });
});
