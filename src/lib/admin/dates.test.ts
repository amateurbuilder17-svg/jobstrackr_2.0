import { describe, expect, it } from "vitest";

import { guessClosingDate, parseLooseDate } from "./dates";

describe("parseLooseDate", () => {
  it("reads the formats these notifications actually print", () => {
    expect(parseLooseDate("2026-06-30")).toBe("2026-06-30");
    expect(parseLooseDate("30/06/2026")).toBe("2026-06-30");
    expect(parseLooseDate("30-6-2026")).toBe("2026-06-30");
    expect(parseLooseDate("30.06.2026")).toBe("2026-06-30");
    expect(parseLooseDate("30 June 2026")).toBe("2026-06-30");
    expect(parseLooseDate("30th Jun, 2026")).toBe("2026-06-30");
    expect(parseLooseDate("30-Jun-2026")).toBe("2026-06-30");
    expect(parseLooseDate("June 30, 2026")).toBe("2026-06-30");
    expect(parseLooseDate("Sept 5 2026")).toBe("2026-09-05");
  });

  it("reads day-first, because every source here is Indian", () => {
    // The whole point: 09/03 is the ninth of March, not the third of September.
    expect(parseLooseDate("09/03/2026")).toBe("2026-03-09");
    expect(parseLooseDate("30/06/26")).toBe("2026-06-30");
  });

  it("strips a time without losing the date", () => {
    expect(parseLooseDate("30/06/2026 (till 5:00 PM)")).toBe("2026-06-30");
    expect(parseLooseDate("30 June 2026 up to 11:59 pm")).toBe("2026-06-30");
  });

  it("returns null rather than inventing a day", () => {
    // The failure this function exists to prevent: the old pipeline turned
    // every one of these into today-plus-a-year and kept dead listings live.
    expect(parseLooseDate("Third week of March")).toBeNull();
    expect(parseLooseDate("June 2026")).toBeNull();
    expect(parseLooseDate("TBD")).toBeNull();
    expect(parseLooseDate("To be announced")).toBeNull();
    expect(parseLooseDate("Notified soon")).toBeNull();
    expect(parseLooseDate("—")).toBeNull();
    expect(parseLooseDate("")).toBeNull();
    expect(parseLooseDate(null)).toBeNull();
  });

  it("refuses a range, which names two days", () => {
    expect(parseLooseDate("01/06/2026 to 30/06/2026")).toBeNull();
    expect(parseLooseDate("1 June 2026 – 30 June 2026")).toBeNull();
  });

  it("refuses a date the calendar does not have", () => {
    expect(parseLooseDate("31/02/2026")).toBeNull();
    expect(parseLooseDate("32/01/2026")).toBeNull();
    expect(parseLooseDate("30/13/2026")).toBeNull();
    // A page number read as a year.
    expect(parseLooseDate("30/06/1204")).toBeNull();
  });
});

describe("guessClosingDate", () => {
  it("picks the closing date out of a notification's date table", () => {
    const result = guessClosingDate([
      { event: "Application Start Date", date: "01/06/2026" },
      { event: "Last Date to Apply Online", date: "30/06/2026" },
      { event: "Exam Date", date: "15/08/2026" },
    ]);

    expect(result.date).toBe("2026-06-30");
    expect(result.entry?.event).toBe("Last Date to Apply Online");
  });

  it("prefers the application close over the fee deadline", () => {
    // Fee payment usually closes a day or two later. Picking it keeps a closed
    // listing open, which is the exact failure mode worth guarding.
    const result = guessClosingDate([
      { event: "Last Date for Fee Payment", date: "02/07/2026" },
      { event: "Last Date", date: "30/06/2026" },
    ]);

    expect(result.date).toBe("2026-06-30");
  });

  it("returns nothing when no entry looks like a closing date", () => {
    const result = guessClosingDate([
      { event: "Exam Date", date: "15/08/2026" },
      { event: "Result Date", date: "20/09/2026" },
    ]);

    expect(result.entry).toBeNull();
    expect(result.date).toBeNull();
  });

  it("skips a closing-date entry whose text does not name a day", () => {
    const result = guessClosingDate([{ event: "Last Date", date: "To be announced" }]);
    expect(result.date).toBeNull();
  });

  it("takes the later of two equally-labelled candidates", () => {
    const result = guessClosingDate([
      { event: "Last Date", date: "20/06/2026" },
      { event: "Last Date (extended)", date: "30/06/2026" },
    ]);

    expect(result.date).toBe("2026-06-30");
  });
});
