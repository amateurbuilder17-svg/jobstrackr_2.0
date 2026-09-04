import { describe, expect, it } from "vitest";

import {
  humanise,
  feeAmount,
  maxFee,
  toDateLinks,
  toFeeRows,
  toImportantDates,
  toOverview,
  toSteps,
  toVacancyTable,
  totalVacancies,
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

describe("totalVacancies", () => {
  /** Every table here is a real one, copied from `job_details` in production. */

  it("reads a single-cell total, ignoring the parenthetical breakdown", () => {
    expect(
      totalVacancies(
        toVacancyTable({
          columns: ["Total Posts"],
          rows: [["23 (5 Typist + 4 Typist Copyist + 9 Process Server + 5 Peon)"]],
        }),
      ),
    ).toBe(23);
  });

  it("sums the count column when the table has no total of its own", () => {
    expect(
      totalVacancies(
        toVacancyTable({
          columns: ["S. No.", "Post Name", "No. Of Posts"],
          rows: [
            ["1", "Scientist 'C' (SC-S)", "1 (UR)"],
            ["2", "Scientist 'C' (SC-L)", "1 (UR)"],
            ["3", "Scientist 'C' (SC-F)", "2 (UR)"],
          ],
        }),
      ),
    ).toBe(4);
  });

  it("uses a total row rather than adding it to the rows it totals", () => {
    // Without this the six posts and their stated total came to 222, exactly
    // twice the real figure — and "Category-I Total" does not start with the
    // word, which is why the match is anywhere in the label.
    expect(
      totalVacancies(
        toVacancyTable({
          columns: ["Post", "Vacancies"],
          rows: [
            ["Geologist, Group A", "29"],
            ["Geophysicist, Group A", "0"],
            ["Chemist, Group A", "7"],
            ["Assistant Geologist, Group B", "34"],
            ["Assistant Geophysicist, Group B", "35"],
            ["Assistant Chemist, Group B", "6"],
            ["Category-I Total", "111"],
          ],
        }),
      ),
    ).toBe(111);
  });

  it("prefers a grand total to the subtotals under it", () => {
    expect(
      totalVacancies(
        toVacancyTable({
          columns: ["S. No.", "Post Name", "No. Of Posts"],
          rows: [
            ["1", "Driver - General Category", "21"],
            ["2", "Driver - SC/ST/BC", "03"],
            ["3", "Driver - Ex-Servicemen", "01"],
            ["-", "Total Driver", "25"],
            ["4", "Frash - General Category", "26"],
            ["5", "Frash - SC/ST/BC", "03"],
            ["6", "Frash - Ex-Servicemen", "02"],
            ["-", "Total Frash", "31"],
            ["-", "Grand Total", "56"],
          ],
        }),
      ),
    ).toBe(56);
  });

  it("adds the subtotals when there is no grand total", () => {
    expect(
      totalVacancies({
        columns: ["Post Name", "Total Posts"],
        rows: [
          ["Driver - General", "21"],
          ["Total Driver", "25"],
          ["Frash - General", "26"],
          ["Total Frash", "31"],
        ],
      }),
    ).toBe(56);
  });

  it("counts one column when a heading repeats", () => {
    // A Southern Railway table: the second "Total Posts" holds the grand total
    // for a single row, the first holds the four rows it totals. Adding both
    // reported 326 for a 163-post notification.
    expect(
      totalVacancies({
        columns: ["Unit", "Trades Covered", "Total Posts", "Post Name", "Total Posts"],
        rows: [
          ["Carriage & Wagon Works, Perambur", "Fitter, Welder, Painter", "80", "", ""],
          ["Central Workshop, Ponmalai", "Fitter, Welder (G&E)", "43", "", ""],
          ["S&T Workshop, Podanur", "Fitter", "20", "", ""],
          ["Railway Hospital, Perambur", "MLT", "20", "", ""],
          ["", "", "", "Fresher's Grand Total", "163"],
        ],
      }),
    ).toBe(163);
  });

  it("declines when no column is a count", () => {
    expect(
      totalVacancies({
        columns: ["Post Name", "Brief Role"],
        rows: [["Branch Postmaster (BPM)", "Overall in-charge of a Branch Post Office"]],
      }),
    ).toBeNull();
  });

  it("declines rather than reporting a total of zero", () => {
    // Zero is an answer for one row of a table. As the whole figure it means
    // the column held nothing countable, and "0 vacancies" on a card is worse
    // than saying nothing.
    expect(totalVacancies({ columns: ["Total Posts"], rows: [["0"]] })).toBeNull();
    expect(totalVacancies(null)).toBeNull();
  });

  it("rejects a count column that is not one", () => {
    expect(
      totalVacancies({
        columns: ["Post", "Total Posts"],
        rows: [["Clerk", "Ten"]],
      }),
    ).toBeNull();
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

  it("returns null when the table does not say", () => {
    expect(maxFee([{ category: "All", fee: "As per online portal" }])).toBeNull();
    expect(maxFee([])).toBeNull();
  });
});

describe("feeAmount", () => {
  it("reads the fee out of the wording notifications actually use", () => {
    // Every one of these is a real cell from the fee tables in this database,
    // and every one of them read as "no fee stated" before.
    expect(feeAmount("Rs. 500/- (Rupees Five Hundred only)")).toBe(500);
    expect(feeAmount("Rs. 200/- plus GST")).toBe(200);
    expect(feeAmount("₹ 300/- (Non-refundable, plus bank charges extra)")).toBe(300);
    expect(feeAmount("Rs. 50 (Processing Charges only)")).toBe(50);
    expect(feeAmount("Rs. 1,180")).toBe(1180);
  });

  it("takes the first figure, not the largest, and ignores asides", () => {
    // The total is what a candidate pays; the breakdown in the bracket is how
    // it is made up. Taking the largest prices this at ₹800.
    expect(feeAmount("Rs. 1500/- (Rs. 800 Application Fee + Rs. 700 Processing Fee)")).toBe(
      1500,
    );
    // And a percentage inside an aside is not a fee of ₹18.
    expect(feeAmount("Rs. 148/- (including 18% GST)")).toBe(148);
    expect(feeAmount("Rs. 600 + 18% GST")).toBe(600);
  });

  it("reads the free wordings as zero, which is an answer", () => {
    for (const free of ["Nil", "NIl", "NIL (Exempted)", "Exempted", "No Application Fee"]) {
      expect(feeAmount(free)).toBe(0);
    }
    expect(feeAmount("₹00")).toBe(0);
    expect(feeAmount("Rs. 0")).toBe(0);
  });

  it("does not read 'no fee is mentioned' as no fee", () => {
    // The one wording that must not become ₹0: it says nobody knows, and
    // printing "No fee" for it would be inventing an answer.
    expect(
      feeAmount("No application fee is mentioned in the official notification."),
    ).toBeNull();
    expect(feeAmount("Refer to the advertisement for specific fees per post")).toBeNull();
  });

  it("refuses a number that is not money", () => {
    // An eligibility table read as a fee table. Priced at ₹32 by any parser
    // that simply takes the first number it finds.
    expect(feeAmount("32 years")).toBeNull();
    expect(feeAmount("35 years (Min. Age- 30 years)")).toBeNull();
    expect(feeAmount("Not applicable under 72nd CCE after corrigendum")).toBeNull();
  });

  it("refuses a document reference that happens to contain a number", () => {
    // Real cell, in a table whose other two rows say ₹1,000. The first number
    // in it is an advertisement number.
    expect(
      feeAmount(
        "Not required to pay again if already paid for Advt. No. 1440/E-12015/24/26 dated 24.06.2026",
      ),
    ).toBeNull();
    // This column is rupees. $30 is not ₹30.
    expect(feeAmount("USD $30")).toBeNull();
  });

  it("accepts a figure a fee word introduces", () => {
    expect(feeAmount("Application fee 500")).toBe(500);
    expect(feeAmount("Fee: Rs. 250")).toBe(250);
  });

  it("refuses a figure too large to be a fee", () => {
    // A salary column that drifted one place left. The largest fee this
    // project has ever parsed is ₹5,000.
    expect(feeAmount("Rs. 35,400")).toBeNull();
  });

  it("does not let a category name become a fee", () => {
    expect(feeAmount("Unreserved (UR)")).toBeNull();
    expect(feeAmount("SC, ST and PwD")).toBeNull();
  });
});

describe("maxFee and a table that is free all the way down", () => {
  it("answers zero rather than nothing", () => {
    // 466 cells in this database read "Nil". Skipping anything not strictly
    // positive made every one of those jobs show no fee information at all,
    // when what the notification says is that it costs nothing to apply.
    expect(
      maxFee([
        { category: "All categories", fee: "Nil" },
        { category: "SC / ST", fee: "Nil" },
      ]),
    ).toBe(0);
  });

  it("still prefers a real rate over a concessional nil", () => {
    expect(
      maxFee([
        { category: "General", fee: "Rs. 500/- (Non-Refundable)" },
        { category: "SC / ST / PwD", fee: "Nil" },
      ]),
    ).toBe(500);
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
