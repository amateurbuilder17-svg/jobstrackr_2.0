import { describe, expect, it } from "vitest";

import { FILTER_GROUPS, JOB_SORT_OPTIONS, labelOf, optionOf } from "./filters";

describe("jobs filter validation", () => {
  it("narrows valid filter options correctly", () => {
    const levelGroup = FILTER_GROUPS[0];
    expect(optionOf(levelGroup, "bachelor")).toBe("bachelor");
    expect(optionOf(levelGroup, "class_10")).toBe("class_10");

    const sectorGroup = FILTER_GROUPS[2];
    expect(optionOf(sectorGroup, "railway")).toBe("railway");
    expect(optionOf(sectorGroup, "banking")).toBe("banking");

    const stateGroup = FILTER_GROUPS[3];
    expect(optionOf(stateGroup, "Maharashtra")).toBe("Maharashtra");
    expect(optionOf(stateGroup, "All India")).toBe("All India");
  });

  it("drops unrecognized or invalid filter values to avoid enum errors", () => {
    const levelGroup = FILTER_GROUPS[0];
    expect(optionOf(levelGroup, "invalid_qualification")).toBeUndefined();
    expect(optionOf(levelGroup, "drop table jobs")).toBeUndefined();
    expect(optionOf(undefined, "bachelor")).toBeUndefined();
  });

  it("returns human-readable labels for valid values", () => {
    const streamGroup = FILTER_GROUPS[1];
    expect(labelOf(streamGroup, "engineering")).toBe("Engineering");
    expect(labelOf(streamGroup, "medical")).toBe("Medical");
    expect(labelOf(streamGroup, "nonexistent")).toBeUndefined();

    const sectorGroup = FILTER_GROUPS[2];
    expect(labelOf(sectorGroup, "railway")).toBe("Railways");
  });

  it("defines comprehensive sort options including vacancy and closing", () => {
    const values = JOB_SORT_OPTIONS.map((s) => s.value);
    expect(values).toContain("closing");
    expect(values).toContain("newest");
    expect(values).toContain("vacancy");
  });
});
