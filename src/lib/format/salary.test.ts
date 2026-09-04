import { describe, expect, it } from "vitest";

import { formatSalary, resolveSalary, resolveSalaryRange, salaryFromText } from "./salary";

describe("formatSalary", () => {
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
});

/**
 * The cases here are production strings. 229 published rows carry a pay-matrix
 * level in `salary_min`, and this is the text each one was misread from.
 */
describe("salaryFromText", () => {
  it("reads the initial pay out of a pay-matrix sentence", () => {
    expect(salaryFromText("Level-2 in 7th CPC Pay Matrix; Initial Pay Rs. 19,900/-")).toEqual({
      min: 19_900,
      max: 19_900,
    });
  });

  it("carries the currency across a range separator", () => {
    expect(salaryFromText("Rs. 60000 - 70000 Per Month")).toEqual({
      min: 60_000,
      max: 70_000,
    });
    expect(
      salaryFromText(
        "Level‑4 Pay Matrix: ₹25,500 – 81,100 per month (7th CPC) plus allowances",
      ),
    ).toEqual({ min: 25_500, max: 81_100 });
  });

  it("ignores the level, the commission and the year", () => {
    expect(salaryFromText("Pay Matrix Level 7 as on 01.01.2026")).toEqual({
      min: null,
      max: null,
    });
    expect(salaryFromText("7th CPC Level 2, revised 2026")).toEqual({ min: null, max: null });
  });

  it("spans every figure a multi-year stipend states", () => {
    expect(
      salaryFromText(
        "₹21,500/- (Year 1) | ₹22,000/- (Year 2) | ₹22,500/- (Year 3) - Consolidated",
      ),
    ).toEqual({ min: 21_500, max: 22_500 });
  });

  it("has nothing to say about prose with no figures", () => {
    expect(salaryFromText("As per rules of the Government of India")).toEqual({
      min: null,
      max: null,
    });
    expect(salaryFromText(null)).toEqual({ min: null, max: null });
  });
});

describe("resolveSalary", () => {
  it("prints a plausible typed range", () => {
    expect(resolveSalary(null, 25_500, 81_100, null)).toBe("₹25,500 – ₹81,100");
  });

  it("refuses a pay-matrix level read as pay", () => {
    expect(resolveSalary(null, 2, 2, null)).toBeNull();
    expect(resolveSalary(null, 7, 7, null)).toBeNull();
  });

  it("recovers the real figure from the sentence the level was misread from", () => {
    expect(
      resolveSalary(null, 2, 2, "Level-2 in 7th CPC Pay Matrix; Initial Pay Rs. 19,900/-"),
    ).toBe("₹19,900");
  });

  it("keeps a genuine figure when only one end is a level", () => {
    expect(resolveSalary(null, 7, 112_400, null)).toBe("₹1,12,400");
  });

  it("prefers the notification's own wording", () => {
    expect(resolveSalary("As per 7th CPC", 2, 2, null)).toBe("As per 7th CPC");
  });

  it("treats a bare number in the display column as the same artefact", () => {
    expect(resolveSalary("2", 2, 2, "Level-2; Initial Pay Rs. 19,900/-")).toBe("₹19,900");
    expect(resolveSalary("19900", null, null, null)).toBe("₹19,900");
  });
});

/** The numeric half, which is what ingest stores and what JSON-LD publishes. */
describe("resolveSalaryRange", () => {
  it("keeps a plausible typed range", () => {
    expect(resolveSalaryRange(25_500, 81_100, null)).toEqual({ min: 25_500, max: 81_100 });
  });

  it("recovers the pay a level was misread from", () => {
    expect(
      resolveSalaryRange(2, 2, "Level-2 in 7th CPC Pay Matrix; Initial Pay Rs. 19,900/-"),
    ).toEqual({ min: 19_900, max: 19_900 });
  });

  it("publishes nothing rather than a level", () => {
    expect(resolveSalaryRange(7, 7, null)).toEqual({ min: null, max: null });
    expect(resolveSalaryRange(2, 2, "Pay Matrix Level 2")).toEqual({ min: null, max: null });
  });

  it("keeps the genuine end when only one is a level", () => {
    expect(resolveSalaryRange(7, 112_400, "Level-7; Rs. 19,900/-")).toEqual({
      min: null,
      max: 112_400,
    });
  });
});
