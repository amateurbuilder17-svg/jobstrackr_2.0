import { describe, expect, it } from "vitest";

import { isSearchable, syllabusKey, syllabusSlug } from "./key";

describe("syllabusKey", () => {
  it("folds the spellings of one exam onto one entry", () => {
    // Every one of these is a real thing someone types, and each one that
    // missed the cache would cost a 30-second grounded model call.
    const same = [
      "SSC CGL",
      "ssc cgl",
      "SSC  CGL",
      "SSC-CGL",
      "SSC/CGL",
      "SSC (CGL)",
      "SSC CGL exam",
      "SSC CGL syllabus",
      "syllabus for SSC CGL",
    ];
    const keys = new Set(same.map(syllabusKey));
    expect(keys).toEqual(new Set(["ssc cgl"]));
  });

  it("drops the year, because a syllabus does not change on 1 January", () => {
    expect(syllabusKey("SSC CGL 2025")).toBe("ssc cgl");
    expect(syllabusKey("SSC CGL 2026")).toBe("ssc cgl");
    expect(syllabusKey("2024 UPSC CSE")).toBe("upsc cse");
  });

  it("keeps four-digit runs that are not years", () => {
    // A post code or a paper number is part of the name, not a date. A bare
    // \d{4} would eat these.
    expect(syllabusKey("RRB NTPC 1234")).toBe("rrb ntpc 1234");
    expect(syllabusKey("Group 4567")).toBe("group 4567");
  });

  it("keeps words that distinguish two exams", () => {
    expect(syllabusKey("SSC CGL Tier 1")).toBe("ssc cgl tier 1");
    expect(syllabusKey("SSC CHSL")).not.toBe(syllabusKey("SSC CGL"));
    expect(syllabusKey("IBPS PO")).not.toBe(syllabusKey("IBPS Clerk"));
  });

  it("builds a slug from the same words, so the URL and the key cannot drift", () => {
    expect(syllabusSlug("SSC CGL 2025")).toBe("ssc-cgl");
    expect(syllabusSlug("UPSC Civil Services Examination")).toBe(
      "upsc civil services".replaceAll(" ", "-"),
    );
    expect(syllabusSlug(syllabusKey("SSC-CGL"))).toBe(syllabusSlug("SSC CGL"));
  });
});

describe("isSearchable", () => {
  it("refuses what is not an exam name", () => {
    expect(isSearchable("")).toBe(false);
    expect(isSearchable("  ")).toBe(false);
    expect(isSearchable("a")).toBe(false);
    // Nothing but noise words and a year.
    expect(isSearchable("exam 2025")).toBe(false);
  });

  it("accepts a short real name", () => {
    expect(isSearchable("SSC")).toBe(true);
    expect(isSearchable("UPSC CSE")).toBe(true);
  });

  it("refuses a pasted notification", () => {
    expect(isSearchable("x".repeat(400))).toBe(false);
  });
});
