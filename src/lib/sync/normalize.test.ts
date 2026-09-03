import { describe, expect, it } from "vitest";

import {
  EMBEDDING_DIMS,
  toBool,
  toDate,
  toDateText,
  toInt,
  toSalary,
  toJson,
  toNum,
  toSlug,
  toStringArray,
  toVacancies,
  toText,
  toVector,
} from "./normalize";

/**
 * The parser this app has exactly one of.
 *
 * The old pipeline kept the same logic in `Html.gs` and `scraper_v5.py` and
 * synchronised them by hand; the recurring scraper bugs were all drift between
 * the two. These tests are the reason one copy is safe to rely on.
 */

describe("toDateText — the Sheet timezone trap", () => {
  it("recovers the day a person actually typed", () => {
    // Apps Script serialises a Kolkata date cell as a UTC instant, so midnight
    // IST on the 30th leaves as 18:30Z on the *29th*. Taking the first ten
    // characters — the obvious implementation — reports the wrong day, and it
    // is wrong for every date in the sheet, silently.
    expect(toDateText("2026-06-29T18:30:00.000Z")).toBe("2026-06-30");
  });

  it("is stable for a date already at IST midnight boundary", () => {
    expect(toDateText("2026-12-31T18:30:00.000Z")).toBe("2027-01-01");
  });

  it("leaves a plain date alone", () => {
    expect(toDateText("2026-06-30")).toBe("2026-06-30");
  });

  it.each(["TBD", "30 Jun 2026", "Notified soon", "As per notification"])(
    "never mangles human text: %s",
    (text) => {
      // These land in `last_date_display`, which exists precisely so the
      // sheet can say "TBD" without the parser inventing a date.
      expect(toDateText(text)).toBe(text);
    },
  );

  it.each([
    ["", null],
    [null, null],
    [undefined, null],
  ] as const)("treats %s as absent", (input, want) => {
    expect(toDateText(input)).toBe(want);
  });

  it("returns the original when the ISO string is unparseable", () => {
    expect(toDateText("2026-13-45T99:99")).toBe("2026-13-45T99:99");
  });
});

describe("toDate — strict date columns", () => {
  it("keeps a real date", () => {
    expect(toDate("2026-06-29T18:30:00.000Z")).toBe("2026-06-30");
  });

  it("drops free text rather than passing it to a date column", () => {
    expect(toDate("TBD")).toBeNull();
    expect(toDate("30 Jun 2026")).toBeNull();
  });
});

describe("toNum / toInt", () => {
  it("reads Indian-formatted currency", () => {
    expect(toNum("₹1,42,400")).toBe(142400);
    expect(toNum("18,000")).toBe(18000);
  });

  it("does not turn empty into zero", () => {
    // `Number("")` is 0, which would write a salary of ₹0 for every blank cell.
    expect(toNum("")).toBeNull();
    expect(toNum("   ")).toBeNull();
  });

  it("rejects text", () => {
    expect(toNum("not a number")).toBeNull();
  });

  it("rejects fractions for integer columns rather than rounding", () => {
    expect(toInt("12.5")).toBeNull();
    expect(toInt("12")).toBe(12);
  });
});

describe("toStringArray", () => {
  it("splits a comma-separated cell", () => {
    expect(toStringArray("banking, railway ,graduate")).toEqual([
      "banking",
      "railway",
      "graduate",
    ]);
  });

  it("passes an array through, trimming", () => {
    expect(toStringArray([" a ", "b"])).toEqual(["a", "b"]);
  });

  it("is empty, not [''], for a blank cell", () => {
    expect(toStringArray("")).toEqual([]);
  });

  /* The sheet's AI enrichment writes the array it built rather than joining
     it, so the cell arrives as JSON. Split on commas, an empty one became the
     single tag "[]" — rendered as a badge on 5,978 update pages. */
  it("parses a JSON array cell instead of splitting it on commas", () => {
    expect(toStringArray("[]")).toEqual([]);
    expect(toStringArray('["banking","railway"]')).toEqual(["banking", "railway"]);
  });

  it("still comma-splits a cell that merely starts with a bracket", () => {
    expect(toStringArray("[draft] notice, result")).toEqual(["[draft] notice", "result"]);
  });
});

describe("toVector", () => {
  const good = Array.from({ length: EMBEDDING_DIMS }, (_, i) => i / 1000);

  it("accepts exactly 384 finite numbers", () => {
    expect(toVector(good)).toHaveLength(EMBEDDING_DIMS);
  });

  it("accepts the same as a JSON string, which is how the Sheet carries it", () => {
    expect(toVector(JSON.stringify(good))).toHaveLength(EMBEDDING_DIMS);
  });

  it.each([
    ["short", Array.from({ length: 100 }, () => 0)],
    ["long", Array.from({ length: 385 }, () => 0)],
  ])("rejects a %s vector", (_label, arr) => {
    // PostgREST would take a wrong-length vector without complaint and it
    // would only surface as similarity search returning nonsense.
    expect(toVector(arr)).toBeNull();
  });

  it("rejects a vector containing NaN", () => {
    const bad = [...good];
    bad[7] = Number.NaN;
    expect(toVector(bad)).toBeNull();
  });

  it("rejects unparseable text", () => {
    expect(toVector("{not json")).toBeNull();
  });
});

describe("toSlug", () => {
  it("is deterministic and url-safe", () => {
    // The em-dash is stripped, and the double space it leaves collapses to a
    // single hyphen rather than "--".
    expect(toSlug("SSC CGL 2026 — Tier I (Prelims)!")).toBe("ssc-cgl-2026-tier-i-prelims");
  });

  it("caps length without leaving a trailing hyphen", () => {
    const slug = toSlug("a".repeat(50) + " " + "b".repeat(50));
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("misc coercions", () => {
  it("toBool understands what a spreadsheet contains", () => {
    expect(toBool("yes")).toBe(true);
    expect(toBool("FALSE")).toBe(false);
    expect(toBool("", true)).toBe(true);
    expect(toBool("maybe", false)).toBe(false);
  });

  it("toText trims and nulls empties", () => {
    expect(toText("  hello ")).toBe("hello");
    expect(toText("   ")).toBeNull();
  });

  it("toJson falls back rather than throwing", () => {
    expect(toJson("{not json", [])).toEqual([]);
    expect(toJson('{"a":1}', {})).toEqual({ a: 1 });
    expect(toJson("", [])).toEqual([]);
  });
});

describe("toSalary", () => {
  it("keeps a real salary", () => {
    expect(toSalary("₹1,12,400")).toBe(112400);
    expect(toSalary(35400)).toBe(35400);
  });

  it("discards a pay-matrix level read as money", () => {
    // "Pay Matrix Level 7" and "₹1,12,400" arrive in the same column, and the
    // old app rendered the first as a salary of ₹7 a month.
    expect(toSalary(7)).toBeNull();
    expect(toSalary("Level 4")).toBeNull();
  });

  it("judges each end on its own", () => {
    // A level in one column must not poison a genuine figure in the other.
    expect(toSalary(7)).toBeNull();
    expect(toSalary(112400)).toBe(112400);
  });
});

describe("toVacancies", () => {
  it("keeps a plausible count", () => {
    expect(toVacancies("17,727")).toBe(17727);
  });

  it("discards a summed stipend column", () => {
    expect(toVacancies(45_000_000)).toBeNull();
  });

  it("rejects a negative count", () => {
    expect(toVacancies(-3)).toBeNull();
  });
});

describe("the scrapers' explicit missing-data markers", () => {
  it.each(["Not Available", "not available", "N/A", "NA", "Nil", "None", "-", "—"])(
    "reads %s as an empty cell",
    (marker) => {
      // `Config.gs` writes these rather than fabricating a plausible value.
      // Stored literally they become a card whose location reads
      // "Not Available", which looks like an answer rather than the absence
      // of one.
      expect(toText(marker)).toBeNull();
    },
  );

  it("keeps TBD, which is an answer", () => {
    // `last_date_display` exists to carry it; the deadline badge renders it.
    expect(toText("TBD")).toBe("TBD");
    expect(toDateText("TBD")).toBe("TBD");
    expect(toDate("TBD")).toBeNull();
  });

  it("does not swallow text that merely contains a marker", () => {
    expect(toText("Vacancy details not available in the notification")).toBe(
      "Vacancy details not available in the notification",
    );
    expect(toText("Nilgiri District")).toBe("Nilgiri District");
  });
});
