import { describe, expect, it } from "vitest";

import {
  CLOSED_JOB_INDEX_DAYS,
  closedJobIndexCutoff,
  isJobIndexable,
  isUpdateIndexable,
} from "./indexing";

const TODAY = "2026-09-22";

describe("closedJobIndexCutoff", () => {
  it("is the window's length before today, as a calendar date", () => {
    expect(CLOSED_JOB_INDEX_DAYS).toBe(30);
    expect(closedJobIndexCutoff(TODAY)).toBe("2026-08-23");
  });

  it("crosses a month and a year boundary", () => {
    expect(closedJobIndexCutoff("2026-03-01")).toBe("2026-01-30");
    expect(closedJobIndexCutoff("2027-01-10")).toBe("2026-12-11");
  });
});

describe("isJobIndexable", () => {
  it("indexes every open listing, whatever its date says", () => {
    expect(isJobIndexable({ status: "published", last_date: "2020-01-01" }, TODAY)).toBe(true);
    expect(isJobIndexable({ status: "published", last_date: null }, TODAY)).toBe(true);
  });

  it("indexes a closed listing up to and including the cutoff day", () => {
    expect(isJobIndexable({ status: "closed", last_date: "2026-09-21" }, TODAY)).toBe(true);
    expect(isJobIndexable({ status: "closed", last_date: "2026-08-23" }, TODAY)).toBe(true);
  });

  it("stops indexing it the day after", () => {
    expect(isJobIndexable({ status: "closed", last_date: "2026-08-22" }, TODAY)).toBe(false);
  });

  it("does not index a closed listing with no date to measure from", () => {
    expect(isJobIndexable({ status: "closed", last_date: null }, TODAY)).toBe(false);
  });

  it("reads a timestamp-shaped date by its calendar day", () => {
    expect(
      isJobIndexable({ status: "closed", last_date: "2026-08-23T00:00:00+00:00" }, TODAY),
    ).toBe(true);
  });
});

describe("isUpdateIndexable", () => {
  it("does not index a recruitment notice, which restates a job page", () => {
    expect(isUpdateIndexable({ category: "notification" })).toBe(false);
  });

  it("indexes every other category", () => {
    for (const category of [
      "admit_card",
      "result",
      "answer_key",
      "syllabus",
      "exam_date",
      "cutoff",
      "news",
    ] as const) {
      expect(isUpdateIndexable({ category }), category).toBe(true);
    }
  });
});
