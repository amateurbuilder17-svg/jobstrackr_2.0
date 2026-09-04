import { describe, expect, it } from "vitest";

import { indexNowPayload } from "./indexnow";

const config = { siteUrl: "https://jobstrackr.in", key: "0123456789abcdef0123456789abcdef" };

/**
 * IndexNow rejects a whole submission for one off-host URL — 422, with the
 * other 499 URLs discarded — so the filtering below is not defensive tidying.
 * It is the difference between a batch landing and a batch being lost with a
 * status code that says nothing about which entry caused it.
 */
describe("indexNowPayload", () => {
  it("names the bare host, not the origin", () => {
    const payload = indexNowPayload(config, ["https://jobstrackr.in/jobs/a"]);
    expect(payload?.host).toBe("jobstrackr.in");
  });

  it("points keyLocation at the root file the protocol will fetch", () => {
    const payload = indexNowPayload(config, ["https://jobstrackr.in/jobs/a"]);
    expect(payload?.keyLocation).toBe(`https://jobstrackr.in/${config.key}.txt`);
  });

  it("drops URLs on another host", () => {
    const payload = indexNowPayload(config, [
      "https://jobstrackr.in/jobs/a",
      "https://example.com/jobs/b",
    ]);
    expect(payload?.urlList).toEqual(["https://jobstrackr.in/jobs/a"]);
  });

  it("drops anything that is not a URL", () => {
    const payload = indexNowPayload(config, ["https://jobstrackr.in/jobs/a", "/jobs/b", ""]);
    expect(payload?.urlList).toEqual(["https://jobstrackr.in/jobs/a"]);
  });

  it("deduplicates", () => {
    const payload = indexNowPayload(config, [
      "https://jobstrackr.in/jobs/a",
      "https://jobstrackr.in/jobs/a",
    ]);
    expect(payload?.urlList).toHaveLength(1);
  });

  it("is null when nothing survives, so no empty POST is made", () => {
    expect(indexNowPayload(config, ["https://example.com/jobs/b"])).toBeNull();
  });
});
