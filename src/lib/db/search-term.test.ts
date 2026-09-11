import { describe, expect, it } from "vitest";

import { toSearchFilter } from "./search-term";

describe("toSearchFilter", () => {
  it("matches every word of a two-word search as a prefix", () => {
    // The reported miss: "ssc steno" against "SSC Stenographer".
    expect(toSearchFilter("ssc steno")).toEqual({ tsquery: "ssc:* & steno:*", orFilters: [] });
  });

  it("matches a one-word search as a prefix", () => {
    expect(toSearchFilter("rrb")).toEqual({ tsquery: "rrb:*", orFilters: [] });
  });

  it("lets a longer word match inside the title too", () => {
    expect(toSearchFilter("SSC stenographer")).toEqual({
      tsquery: "ssc:*",
      orFilters: ["search_vector.fts(jt_search).stenographer:*,title.ilike.*stenographer*"],
    });
  });

  it("treats blank and one-character input as no filter", () => {
    expect(toSearchFilter(undefined)).toBeNull();
    expect(toSearchFilter("   ")).toBeNull();
    expect(toSearchFilter("n")).toBeNull();
    expect(toSearchFilter("!!")).toBeNull();
  });

  it("keeps a one-character token exact rather than a prefix", () => {
    expect(toSearchFilter("group d")?.tsquery).toBe("group:* & d");
  });

  it("lets no tsquery or PostgREST syntax through", () => {
    const filter = toSearchFilter("ssc (cgl), 'tier'&1 | !x:*");
    expect(filter?.tsquery).toBe("ssc:* & cgl:* & tier:* & 1 & x");
    expect(filter?.orFilters).toEqual([]);
  });

  it("drops words that describe the whole site, unless nothing else is left", () => {
    expect(toSearchFilter("ssc exam")?.tsquery).toBe("ssc:*");
    expect(toSearchFilter("exam jobs")?.tsquery).toBe("exam:* & jobs:*");
  });

  it("collapses repeats and bounds the number of tokens", () => {
    expect(toSearchFilter("ssc ssc SSC")?.tsquery).toBe("ssc:*");
    expect(toSearchFilter("a1 b2 c3 d4 e5 f6 g7 h8")?.tsquery).toBe(
      "a1:* & b2:* & c3:* & d4:* & e5:* & f6:*",
    );
  });
});
