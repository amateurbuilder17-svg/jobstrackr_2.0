import { describe, expect, it } from "vitest";

import { toIsoDate, toSuggestions } from "./fields";

const empty: Record<string, string | null> = {};

describe("toSuggestions", () => {
  it("only offers fields on the whitelist", () => {
    const suggestions = toSuggestions(
      {
        full_name: "Ravi Kumar",
        // Not in FIELD_MAP. A model that invents a key must not reach a column.
        salary: "50000",
        is_admin: "true",
        preferred_sectors: "banking",
      },
      empty,
    );
    expect(suggestions.map((s) => s.column)).toEqual(["full_name"]);
  });

  it("maps the prompt's spelling onto this schema's column", () => {
    // The prompts say `aadhar_number` because that is what the old project's
    // prompt said, and the prompt is pinned. The column here is `aadhaar_number`.
    const [suggestion] = toSuggestions({ aadhar_number: "123412341234" }, empty);
    expect(suggestion?.column).toBe("aadhaar_number");
  });

  it("drops the strings a model uses for 'could not read'", () => {
    for (const value of ["null", "N/A", "na", "none", "NOT FOUND", "-", "", "   "]) {
      expect(toSuggestions({ full_name: value }, empty), value).toEqual([]);
    }
  });

  it("does not offer a change that is not a change", () => {
    expect(toSuggestions({ full_name: "Ravi Kumar" }, { full_name: "Ravi Kumar" })).toEqual([]);
  });

  it("carries what would be replaced, so the review can show both", () => {
    const [suggestion] = toSuggestions(
      { full_name: "Ravi Kumar Singh" },
      { full_name: "Ravi Kumar" },
    );
    expect(suggestion).toMatchObject({
      label: "Full name",
      value: "Ravi Kumar Singh",
      current: "Ravi Kumar",
    });
  });

  it("separates education fields from profile fields", () => {
    const suggestions = toSuggestions(
      { full_name: "Ravi", board_university: "CBSE", percentage: "78.5%" },
      empty,
    );
    const byColumn = Object.fromEntries(suggestions.map((s) => [s.column, s.education]));
    expect(byColumn).toEqual({
      full_name: false,
      board_university: true,
      percentage: true,
    });
  });

  it("normalises gender, category and qualification onto the enums", () => {
    expect(toSuggestions({ gender: "M" }, empty)[0]?.value).toBe("male");
    expect(toSuggestions({ gender: "Female" }, empty)[0]?.value).toBe("female");
    expect(toSuggestions({ category: "OBC-NCL" }, empty)[0]?.value).toBe("obc_ncl");
    expect(toSuggestions({ category: "UR" }, empty)[0]?.value).toBe("general");
    expect(toSuggestions({ qualification_type: "graduation" }, empty)[0]?.value).toBe(
      "bachelor",
    );
    // A word the enum has no room for is dropped rather than guessed at.
    expect(toSuggestions({ category: "Backward" }, empty)).toEqual([]);
    expect(toSuggestions({ gender: "Other" }, empty)).toEqual([]);
  });

  it("reads a percentage out of what a marksheet prints", () => {
    expect(toSuggestions({ percentage: "78.5%" }, empty)[0]?.value).toBe(78.5);
    expect(toSuggestions({ percentage: "78.5 %" }, empty)[0]?.value).toBe(78.5);
    expect(toSuggestions({ percentage: 91 }, empty)[0]?.value).toBe(91);
    // A CGPA in the percentage field, or a transcription error.
    expect(toSuggestions({ percentage: "780" }, empty)).toEqual([]);
    expect(toSuggestions({ percentage: "-5" }, empty)).toEqual([]);
  });

  it("drops a field the model filled with the whole document", () => {
    // A 500-character "address" is a transcription of the certificate. Offering
    // it to be accepted into an address column is worse than dropping it.
    expect(toSuggestions({ address: "x".repeat(400) }, empty)).toEqual([]);
    expect(toSuggestions({ address: "12 MG Road, Bhubaneswar" }, empty)).toHaveLength(1);
  });

  it("survives a response that is not an object", () => {
    expect(toSuggestions(null, empty)).toEqual([]);
    expect(toSuggestions("no data", empty)).toEqual([]);
    expect(toSuggestions([1, 2, 3], empty)).toEqual([]);
  });
});

describe("toIsoDate", () => {
  it("reads day-first, which is what Indian documents use", () => {
    // The one that matters: `new Date("01/02/2003")` is 1 February in some
    // engines and 2 January in others. On a date of birth that is an
    // eleven-month error in somebody's age, and age decides eligibility.
    expect(toIsoDate("01/02/2003")).toBe("2003-02-01");
    expect(toIsoDate("15-08-2003")).toBe("2003-08-15");
    expect(toIsoDate("15.08.2003")).toBe("2003-08-15");
  });

  it("accepts ISO unchanged", () => {
    expect(toIsoDate("2003-08-15")).toBe("2003-08-15");
  });

  it("reads a written month", () => {
    expect(toIsoDate("15 August 2003")).toBe("2003-08-15");
    expect(toIsoDate("15 Aug 2003")).toBe("2003-08-15");
    expect(toIsoDate("5 Sep, 1998")).toBe("1998-09-05");
  });

  it("accepts a bare year, which is what a marksheet prints", () => {
    expect(toIsoDate("2019")).toBe("2019-01-01");
  });

  it("rejects a date that does not exist rather than rolling it over", () => {
    // Date would turn 31 February into 3 March and store it without complaint.
    expect(toIsoDate("31/02/2003")).toBeNull();
    expect(toIsoDate("32/01/2003")).toBeNull();
    expect(toIsoDate("15/13/2003")).toBeNull();
  });

  it("rejects what it cannot read", () => {
    expect(toIsoDate("sometime in 2003")).toBeNull();
    expect(toIsoDate("")).toBeNull();
    expect(toIsoDate("15/08/03")).toBeNull();
    expect(toIsoDate("1899")).toBeNull();
  });
});
