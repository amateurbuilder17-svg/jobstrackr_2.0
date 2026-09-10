import { describe, expect, it } from "vitest";

import {
  extendsOrganization,
  initialism,
  organizationKeysFromTitle,
  parentheticalAcronym,
} from "./organization-name";

/**
 * Every case below is a real string from the live feed or the organisations
 * table. The failure these guard against is not a crash — it is a listing
 * filed under the wrong employer, which nobody reports as a bug.
 */

describe("parentheticalAcronym", () => {
  it("reads the acronym a name carries in brackets", () => {
    expect(parentheticalAcronym("National Aluminium Company Limited (NALCO)")).toBe("nalco");
    expect(parentheticalAcronym("All India Institute of Medical Sciences (AIIMS)")).toBe(
      "aiims",
    );
  });

  it("ignores a bracketed phrase that is a qualifier, not a name", () => {
    expect(parentheticalAcronym("Some Body (Recruitment Cell)")).toBeNull();
    expect(parentheticalAcronym("Some Body (New Delhi)")).toBeNull();
  });

  it("has nothing to say about a plain name", () => {
    expect(parentheticalAcronym("Staff Selection Commission")).toBeNull();
  });
});

describe("organizationKeysFromTitle", () => {
  it("offers the longest reading first", () => {
    const keys = organizationKeysFromTitle("Bank of Baroda C&IC Recruitment 2026");

    // `Bank of Baroda` must be tried before `Bank`, or every bank in the
    // country resolves to the first one on file.
    expect(keys.indexOf("bank-of-baroda")).toBeLessThan(keys.indexOf("bank"));
    expect(keys[keys.length - 1]).toBe("bank");
  });

  it("exposes the leading acronym as a key of its own", () => {
    expect(organizationKeysFromTitle("AIIMS CRE-5 Recruitment 2026")).toContain("aiims");
  });

  it("stops at six words, where a body stops and a job starts", () => {
    const keys = organizationKeysFromTitle("one two three four five six seven eight");

    expect(keys).toHaveLength(6);
    expect(keys[0]).toBe("one-two-three-four-five-six");
  });

  it("says nothing about an empty title", () => {
    expect(organizationKeysFromTitle("")).toEqual([]);
  });
});

describe("extendsOrganization", () => {
  it("recognises a role welded onto a known body", () => {
    // The 850-row duplication pattern, in one assertion.
    expect(extendsOrganization("pspcl", "pspcl-je")).toBe(true);
    expect(extendsOrganization("pspcl", "pspcl-assistant-lineman")).toBe(true);
  });

  it("refuses to match across a word boundary", () => {
    // `ss` must never swallow `ssc-gd`; that is how a body eats its neighbours.
    expect(extendsOrganization("ss", "ssc-gd")).toBe(false);
    expect(extendsOrganization("bank", "banking-board")).toBe(false);
  });

  it("is not true of a name against itself", () => {
    expect(extendsOrganization("pspcl", "pspcl")).toBe(false);
  });

  it("is not true in the other direction", () => {
    expect(extendsOrganization("pspcl-je", "pspcl")).toBe(false);
  });
});

describe("initialism", () => {
  it("reads the initials, skipping the words that carry no identity", () => {
    expect(initialism("Punjab State Power Corporation Limited")).toBe("pspcl");
    expect(initialism("All India Institute of Medical Sciences")).toBe("aiims");
  });

  it("declines a name too short to have an acronym worth trusting", () => {
    expect(initialism("Indian Navy")).toBeNull();
    expect(initialism("Bank of Baroda")).toBeNull();
  });
});
