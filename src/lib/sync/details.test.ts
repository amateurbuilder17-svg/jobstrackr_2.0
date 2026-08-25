import { describe, expect, it } from "vitest";

import { feeFromTable, hasDetailContent, toJobDetailPayload } from "./details";

describe("toJobDetailPayload", () => {
  it("reads the new feed's flat columns", () => {
    const payload = toJobDetailPayload({
      description: "  Applications are invited.  ",
      eligibility_text: "Graduate in any discipline",
      apply_link: "https://ssc.gov.in/apply",
      selection_process: ["Tier I", "Tier II"],
    });

    expect(payload.description).toBe("Applications are invited.");
    expect(payload.eligibility_text).toBe("Graduate in any discipline");
    expect(payload.apply_link).toBe("https://ssc.gov.in/apply");
    expect(payload.selection_process).toEqual(["Tier I", "Tier II"]);
  });

  it("reads the old project's nested job_metadata blob", () => {
    // This is what makes one function safe for both the worker and the
    // backfill: a backfill that normalised differently would produce two
    // populations of rows that render differently.
    const payload = toJobDetailPayload({
      title: "Clerk",
      job_metadata: {
        salary_text: "Level 4 of the pay matrix",
        age_limit_text: "18-27 years. SC/ST: 5 years relaxation.",
        important_dates: { last_date: "31 Jan 2026" },
        application_fees: [{ category: "General", fee: "₹500" }],
      },
    });

    expect(payload.salary_text).toBe("Level 4 of the pay matrix");
    expect(payload.age_limit_text).toContain("relaxation");
    expect(payload.important_dates).toEqual([{ event: "Last Date", date: "31 Jan 2026" }]);
    expect(payload.application_fees).toEqual([{ category: "General", fee: "₹500" }]);
  });

  it("parses job_metadata that arrived as a JSON string", () => {
    const payload = toJobDetailPayload({
      job_metadata: JSON.stringify({ description: "From a Sheets cell" }),
    });
    expect(payload.description).toBe("From a Sheets cell");
  });

  it("drops blocked links instead of storing them", () => {
    const payload = toJobDetailPayload({
      apply_link: "https://www.freejobalert.com/ssc/",
      official_website: "ssc.gov.in",
      notification_pdf: "https://t.me/channel",
    });

    expect(payload.apply_link).toBeNull();
    expect(payload.official_website).toBe("https://ssc.gov.in/");
    expect(payload.notification_pdf).toBeNull();
  });

  it("writes null rather than an empty array", () => {
    // A column holding [] renders as a heading with nothing under it, and
    // `is not null` is the natural way to ask whether there is anything to show.
    const payload = toJobDetailPayload({ selection_process: [], important_dates: {} });
    expect(payload.selection_process).toBeNull();
    expect(payload.important_dates).toBeNull();
  });

  it("never populates raw", () => {
    // 5,800 rows of duplicated blob is 35 MB against a 500 MB ceiling.
    expect(toJobDetailPayload({ anything: "here" }).raw).toBeNull();
  });
});

describe("hasDetailContent", () => {
  it("is false for a row that says nothing", () => {
    expect(hasDetailContent(toJobDetailPayload({ title: "Clerk" }))).toBe(false);
  });

  it("is true as soon as one field lands", () => {
    expect(hasDetailContent(toJobDetailPayload({ description: "Something" }))).toBe(true);
  });
});

describe("feeFromTable", () => {
  it("recovers a fee for the card when the typed column is empty", () => {
    expect(
      feeFromTable({
        job_metadata: {
          application_fees: [
            { category: "SC/ST", fee: "Nil" },
            { category: "General", fee: "Rs. 750/-" },
          ],
        },
      }),
    ).toBe(750);
  });

  it("is null when there is no table", () => {
    expect(feeFromTable({ title: "Clerk" })).toBeNull();
  });
});
