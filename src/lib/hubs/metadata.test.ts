import { describe, expect, it } from "vitest";

import { ALL_JOBS_HUB, stateHub } from "./catalog";
import { hubMetadata } from "./metadata";

const goa = stateHub("goa");
if (!goa) throw new Error("the catalogue has no Goa hub");

describe("hubMetadata", () => {
  it("gives page 1 the bare path as its canonical", () => {
    const meta = hubMetadata(goa, 1, 40);
    expect(meta.title).toBe("Government jobs in Goa");
    expect(meta.alternates?.canonical).toBe("/states/goa");
    expect(meta.robots).toBeUndefined();
  });

  it("gives every later page its own canonical and a numbered title", () => {
    const meta = hubMetadata(goa, 3, 400);
    expect(meta.title).toBe("Government jobs in Goa — page 3");
    expect(meta.alternates?.canonical).toBe("/states/goa/page/3");
  });

  it("numbers an archive's first page", () => {
    expect(hubMetadata(ALL_JOBS_HUB, 1, 4000).alternates?.canonical).toBe("/jobs/page/1");
  });

  it("keeps a thin hub out of the index but lets its links be followed", () => {
    expect(hubMetadata(goa, 1, 2).robots).toEqual({ index: false, follow: true });
    expect(hubMetadata(goa, 1, 0).robots).toEqual({ index: false, follow: true });
    expect(hubMetadata(goa, 1, 3).robots).toBeUndefined();
  });
});
