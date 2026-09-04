import { describe, expect, it } from "vitest";

import { decodeEntities, truncateWords } from "./text";

describe("decodeEntities", () => {
  it("decodes the entities scraped descriptions actually carry", () => {
    expect(decodeEntities("Young Professional &ndash; I (YP-I)")).toBe(
      "Young Professional – I (YP-I)",
    );
    expect(decodeEntities("Ministry of Health &amp; Family Welfare")).toBe(
      "Ministry of Health & Family Welfare",
    );
    expect(decodeEntities("Apply&nbsp;online")).toBe("Apply online");
  });

  it("decodes numeric entities in both bases", () => {
    expect(decodeEntities("Rs. &#8377;500")).toBe("Rs. ₹500");
    expect(decodeEntities("&#x2013; dash")).toBe("– dash");
  });

  it("is idempotent, which is what makes decoding on both write and read safe", () => {
    const once = decodeEntities("A &ndash; B &amp; C");
    expect(decodeEntities(once)).toBe(once);
  });

  it("does not double-decode an escaped entity the source meant literally", () => {
    // "&amp;ndash;" is how a page writes the visible text "&ndash;".
    expect(decodeEntities("&amp;ndash;")).toBe("&ndash;");
  });

  it("leaves unknown and malformed entities alone", () => {
    expect(decodeEntities("100 &widget; & 200")).toBe("100 &widget; & 200");
    expect(decodeEntities("&#0;")).toBe("&#0;");
  });

  it("returns short-circuit for text with no entities at all", () => {
    expect(decodeEntities("Plain text")).toBe("Plain text");
  });
});

describe("truncateWords", () => {
  it("leaves a short summary alone", () => {
    expect(truncateWords("Graduate", 16)).toBeNull();
    expect(truncateWords("Bachelor's degree in any discipline", 16)).toBeNull();
  });

  it("cuts a long one and marks the cut", () => {
    expect(truncateWords("a b c d e", 3)).toBe("a b c…");
  });

  it("does not leave punctuation stranded before the ellipsis", () => {
    expect(truncateWords("M.Sc. in Geology, Applied Geology, or Hydrogeology", 3)).toBe(
      "M.Sc. in Geology…",
    );
  });

  it("counts words, not whitespace", () => {
    expect(truncateWords("  a   b  ", 2)).toBeNull();
  });
});
