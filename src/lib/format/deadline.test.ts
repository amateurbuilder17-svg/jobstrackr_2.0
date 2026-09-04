import { describe, expect, it } from "vitest";

import {
  daysUntil,
  describeDeadline,
  formatVacancies,
  formatCount,
  formatDate,
  formatDeadlineText,
  todayInIndia,
} from "./deadline";

/**
 * The timezone cases are the point of this file. A UTC server comparing against
 * an IST calendar date reports a job closed for the last 5.5 hours it is
 * actually open — which, on the final evening of an application window, is the
 * difference between someone applying and not.
 */
describe("todayInIndia", () => {
  it("is already tomorrow in India when UTC is still on the previous evening", () => {
    // 2026-03-09 20:00 UTC is 2026-03-10 01:30 IST.
    expect(todayInIndia(new Date("2026-03-09T20:00:00Z"))).toBe("2026-03-10");
  });

  it("is still today in India just before the IST rollover", () => {
    // 2026-03-09 18:00 UTC is 2026-03-09 23:30 IST.
    expect(todayInIndia(new Date("2026-03-09T18:00:00Z"))).toBe("2026-03-09");
  });
});

describe("daysUntil", () => {
  const now = new Date("2026-03-10T06:00:00Z"); // 11:30 IST

  it.each([
    ["2026-03-10", 0],
    ["2026-03-11", 1],
    ["2026-03-17", 7],
    ["2026-03-09", -1],
  ])("%s is %s days away", (date, expected) => {
    expect(daysUntil(date, now)).toBe(expected);
  });

  it("returns null for a missing date", () => {
    expect(daysUntil(null, now)).toBeNull();
  });

  it("accepts a full timestamp, not just a date", () => {
    expect(daysUntil("2026-03-12T00:00:00+05:30", now)).toBe(2);
  });

  it("still counts the deadline as today late on the final IST evening", () => {
    // 2026-03-10 17:00 UTC is 22:30 IST on the 10th — the window is still open.
    expect(daysUntil("2026-03-10", new Date("2026-03-10T17:00:00Z"))).toBe(0);
  });
});

describe("describeDeadline", () => {
  const now = new Date("2026-03-10T06:00:00Z");

  it.each([
    ["2026-03-09", "closed", "neutral"],
    ["2026-03-10", "today", "critical"],
    ["2026-03-11", "urgent", "critical"],
    ["2026-03-13", "urgent", "critical"],
    ["2026-03-14", "soon", "warn"],
    ["2026-03-24", "soon", "warn"],
    ["2026-03-25", "open", "neutral"],
  ])("%s is %s", (date, urgency, tone) => {
    const d = describeDeadline(date, now);
    expect(d.urgency).toBe(urgency);
    expect(d.tone).toBe(tone);
  });

  it("says the last day rather than counting zero", () => {
    expect(describeDeadline("2026-03-10", now).label).toBe("Last day");
  });

  it("uses the singular for one day", () => {
    expect(describeDeadline("2026-03-11", now).label).toBe("1 day left");
  });

  it("is explicit when no date is known", () => {
    expect(describeDeadline(null, now).label).toBe("Date not announced");
  });
});

describe("formatting", () => {
  it("groups digits the Indian way", () => {
    expect(formatCount(17_727)).toBe("17,727");
    expect(formatCount(177_270)).toBe("1,77,270");
  });

  it("formats dates unambiguously", () => {
    expect(formatDate("2026-03-10")).toBe("10 Mar 2026");
  });

  it("returns null rather than 'Invalid Date'", () => {
    expect(formatDate("nonsense")).toBeNull();
    expect(formatCount(null)).toBeNull();
  });
});

describe("formatVacancies", () => {
  it("prints a scraped string that already carries its own noun, verbatim", () => {
    // The bug this replaced rendered "10 Posts vacancies" on every such row.
    expect(formatVacancies("10 Posts", 10)).toBe("10 Posts");
    expect(formatVacancies("Various", null)).toBe("Various");
    expect(formatVacancies("32,438 Posts", 32438)).toBe("32,438 Posts");
  });

  it("supplies a noun when the display value is only a number", () => {
    expect(formatVacancies("1,200", 1200)).toBe("1,200 vacancies");
    expect(formatVacancies("1", 1)).toBe("1 vacancy");
  });

  it("falls back to the typed count when there is no display value", () => {
    expect(formatVacancies(null, 17727)).toBe("17,727 vacancies");
    expect(formatVacancies("   ", 5)).toBe("5 vacancies");
    expect(formatVacancies(null, 1)).toBe("1 vacancy");
  });

  it("treats feed placeholders as absent, not as a value", () => {
    // The feed writes these instead of leaving the cell empty; rendering them
    // put "Not Available" in the slot where a vacancy count belongs.
    for (const junk of [
      "Not Available",
      // 551 of the 2,601 published rows carry this one, and every one of them
      // printed the words "Not Found" where the count belongs.
      "Not Found",
      "N/A",
      "n.a.",
      "TBD",
      "—",
      "Nil",
      "Not Specified",
      "Check Notice",
      "As per notification",
    ]) {
      expect(formatVacancies(junk, null)).toBeNull();
    }
  });

  it("falls back to the typed count when the display value is a placeholder", () => {
    expect(formatVacancies("Not Available", 42)).toBe("42 vacancies");
    // The count here is the one recovered from the vacancy breakdown table.
    expect(formatVacancies("Not Found", 24)).toBe("24 vacancies");
  });

  it("keeps a real answer that merely contains a placeholder word", () => {
    expect(formatVacancies("Various Posts", null)).toBe("Various Posts");
  });

  it("returns null when there is nothing to say", () => {
    expect(formatVacancies(null, null)).toBeNull();
  });
});

describe("formatDeadlineText", () => {
  it("keeps wording a date column cannot hold", () => {
    expect(formatDeadlineText("To be announced", "2026-03-10")).toBe("To be announced");
    expect(formatDeadlineText("Walk-in", null)).toBe("Walk-in");
  });

  it("formats a display column that is really a machine date", () => {
    // 4,884 of 6,003 production rows carry an ISO string here, and the page
    // printed "2026-08-25" under a heading that said "Closes".
    expect(formatDeadlineText("2026-08-25", "2026-08-25")).toBe("25 Aug 2026");
    expect(formatDeadlineText("25-08-2026", "2026-08-25")).toBe("25 Aug 2026");
  });

  it("falls back to the display string when the typed column is empty", () => {
    expect(formatDeadlineText("2026-08-25", null)).toBe("25 Aug 2026");
  });

  it("uses the typed date when there is no display string", () => {
    expect(formatDeadlineText(null, "2026-08-25")).toBe("25 Aug 2026");
    expect(formatDeadlineText("   ", "2026-08-25")).toBe("25 Aug 2026");
  });

  it("is null when neither says anything", () => {
    expect(formatDeadlineText(null, null)).toBeNull();
  });
});
