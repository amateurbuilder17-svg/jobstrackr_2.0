import { describe, expect, it } from "vitest";

import {
  daysUntil,
  describeDeadline,
  formatCount,
  formatDate,
  formatSalary,
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

  it("prints a salary range", () => {
    expect(formatSalary(25_500, 81_100)).toBe("₹25,500 – ₹81,100");
  });

  it("collapses an equal range to one figure", () => {
    expect(formatSalary(25_500, 25_500)).toBe("₹25,500");
  });

  it("handles a one-sided range", () => {
    expect(formatSalary(null, 81_100)).toBe("₹81,100");
    expect(formatSalary(25_500, null)).toBe("₹25,500");
    expect(formatSalary(null, null)).toBeNull();
  });

  it("formats dates unambiguously", () => {
    expect(formatDate("2026-03-10")).toBe("10 Mar 2026");
  });

  it("returns null rather than 'Invalid Date'", () => {
    expect(formatDate("nonsense")).toBeNull();
    expect(formatCount(null)).toBeNull();
  });
});
