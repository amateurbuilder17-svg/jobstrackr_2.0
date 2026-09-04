import { describe, expect, it } from "vitest";

import { isLongQualification } from "./job-detail-grid";

describe("isLongQualification", () => {
  it("returns false for null or empty strings", () => {
    expect(isLongQualification(null)).toBe(false);
    expect(isLongQualification("")).toBe(false);
  });

  it("returns false for qualifications with 16 or fewer words", () => {
    expect(isLongQualification("10th Pass with ITI/Diploma/Engineering Degree")).toBe(false);
    expect(
      isLongQualification(
        "Bachelor's degree in Engineering from a recognised university or institute in any discipline",
      ),
    ).toBe(false);
  });

  it("returns true for qualifications exceeding 16 words", () => {
    const long =
      "Candidates must fulfill all eligibility conditions as on the closing date of online application (14-06-2026). Educational/Technical qualification certificates must be from a recognized Board/University/Institute.";
    expect(isLongQualification(long)).toBe(true);
  });
});
