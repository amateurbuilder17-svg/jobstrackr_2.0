import { describe, expect, it } from "vitest";

import {
  humanise,
  maxFee,
  toDateLinks,
  toFeeRows,
  toImportantDates,
  toOverview,
  toSteps,
  toVacancyTable,
} from "./detail-shape";

/**
 * These parsers exist because three scrapers disagree about every shape, so the
 * tests are written against the shapes actually observed in the old project's
 * `job_metadata` rather than against a tidy invented one.
 */

describe("toImportantDates", () => {
  it("reads the object-map shape the job scraper emits", () => {
    expect(
      toImportantDates({ application_start: "01 Jan 2026", last_date: "31 Jan 2026" }),
    ).toEqual([
      { event: "Application Start", date: "01 Jan 2026" },
      { event: "Last Date", date: "31 Jan 2026" },
    ]);
  });

  it("reads the array shape the exam-update scraper emits", () => {
    expect(
      toImportantDates([
        { event: "Exam Date", date: "12 Mar 2026" },
        { label: "Result", value: "April 2026" },
      ]),
    ).toEqual([
      { event: "Exam Date", date: "12 Mar 2026" },
      { event: "Result", date: "April 2026" },
    ]);
  });

  it("parses JSON that arrived as a string, which is how a Sheets cell holds it", () => {
    expect(toImportantDates('[{"event":"Exam","date":"1 Feb"}]')).toEqual([
      { event: "Exam", date: "1 Feb" },
    ]);
  });

  it("drops rows whose date column is a link, not a date", () => {
    expect(
      toImportantDates([
        { event: "Admit card", date: "Click Here" },
        { event: "Exam", date: "12 Mar 2026" },
      ]),
    ).toEqual([{ event: "Exam", date: "12 Mar 2026" }]);
  });

  it("de-duplicates the same fact arriving from two sources", () => {
    expect(
      toImportantDates([
        { event: "Exam Date", date: "12 Mar 2026" },
        { event: "exam date", date: "12 MAR 2026" },
      ]),
    ).toHaveLength(1);
  });

  it("treats placeholders as absent rather than as a value", () => {
    expect(toImportantDates({ last_date: "N/A", exam_date: "--" })).toEqual([]);
  });
});

describe("toDateLinks", () => {
  it("recovers the link from a Click here row rather than losing it", () => {
    expect(
      toDateLinks([
        { event: "Admit card", date: "Click Here", link: "https://x.gov.in/a.pdf" },
      ]),
    ).toEqual([{ text: "Admit card", url: "https://x.gov.in/a.pdf" }]);
  });
});

describe("toVacancyTable", () => {
  it("keeps column order stable when a later row carries an extra key", () => {
    const table = toVacancyTable([
      { post_name: "Clerk", total: "10" },
      { post_name: "Steno", total: "5", category: "OBC" },
    ]);
    expect(table).toEqual({
      columns: ["Post Name", "Total", "Category"],
      rows: [
        ["Clerk", "10", ""],
        ["Steno", "5", "OBC"],
      ],
    });
  });

  it("drops a header row the scraper read as data", () => {
    const table = toVacancyTable([
      { a: "Post Name", b: "Total Posts" },
      { a: "Clerk", b: "10" },
    ]);
    expect(table?.rows).toEqual([["Clerk", "10"]]);
  });

  it("passes an already-normalised table through unchanged", () => {
    const normalised = { columns: ["Post"], rows: [["Clerk"]] };
    expect(toVacancyTable(normalised)).toEqual(normalised);
  });

  it("returns null rather than an empty table", () => {
    expect(toVacancyTable([])).toBeNull();
    expect(toVacancyTable("not a table")).toBeNull();
  });
});

describe("toFeeRows and maxFee", () => {
  it("reads both the array and the object-map shapes", () => {
    expect(toFeeRows([{ category: "General", fee: "₹500" }])).toEqual([
      { category: "General", fee: "₹500" },
    ]);
    expect(toFeeRows({ general: "Rs. 500/-" })).toEqual([
      { category: "General", fee: "Rs. 500/-" },
    ]);
  });

  it("takes the highest fee, which is what a stranger will pay", () => {
    expect(
      maxFee([
        { category: "SC/ST", fee: "₹0" },
        { category: "General", fee: "Rs. 1,000/-" },
        { category: "Female", fee: "Nil" },
      ]),
    ).toBe(1000);
  });

  it("returns null when no row carries a number", () => {
    expect(maxFee([{ category: "All", fee: "Exempted" }])).toBeNull();
  });
});

describe("toSteps", () => {
  it("splits a numbered single string without splitting on commas", () => {
    expect(toSteps("1. Written test 2. Physical test, including a 1600m run")).toEqual([
      "Written test",
      "Physical test, including a 1600m run",
    ]);
  });

  it("reads an array of records", () => {
    expect(toSteps([{ step: "Tier I" }, { step: "Tier II" }])).toEqual(["Tier I", "Tier II"]);
  });
});

describe("toOverview", () => {
  it("drops entries the key-facts table already renders", () => {
    expect(
      toOverview({ post_name: "Clerk", conducting_body: "SSC", last_date: "31 Jan" }),
    ).toEqual([{ label: "Conducting Body", value: "SSC" }]);
  });
});

describe("humanise", () => {
  it("turns a raw JSON key into a heading", () => {
    expect(humanise("post_name")).toBe("Post Name");
  });
});

describe("toFeeRows and the word Nil", () => {
  it("keeps a concessional row that reads Nil", () => {
    // "Nil" is how a notification says SC/ST/PwD candidates pay nothing. The
    // shared placeholder list treats it as an empty cell, which deleted exactly
    // the rows a reader most wants and left only the general category's fee.
    expect(
      toFeeRows([
        { category: "General", fee: "₹100" },
        { category: "SC / ST / PwD", fee: "Nil" },
        { category: "Women", fee: "None" },
      ]),
    ).toEqual([
      { category: "General", fee: "₹100" },
      { category: "SC / ST / PwD", fee: "Nil" },
      { category: "Women", fee: "None" },
    ]);
  });

  it("still drops a genuinely unknown fee", () => {
    expect(toFeeRows([{ category: "General", fee: "N/A" }])).toEqual([]);
  });

  it("does not treat Nil as a date", () => {
    expect(toImportantDates([{ event: "Exam", date: "Nil" }])).toEqual([]);
  });
});
