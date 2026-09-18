import { describe, expect, it } from "vitest";

import { cachedRedirect } from "./cached-redirect";

const request = new Request("https://www.jobstrackr.in/job/abc");

describe("cachedRedirect", () => {
  it("caches a resolved legacy URL at the CDN for a year", () => {
    const response = cachedRedirect(request, "/jobs/ssc-cgl-2026", true);

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://www.jobstrackr.in/jobs/ssc-cgl-2026",
    );
    expect(response.headers.get("cache-control")).toContain("s-maxage=31536000");
  });

  // A miss may only mean the row is not ingested yet, so it must not be pinned
  // at the edge for long, and must not be a permanent redirect a crawler keeps.
  it("caches a miss for a day, as a temporary redirect", () => {
    const response = cachedRedirect(request, "/jobs", false);

    expect(response.status).toBe(307);
    expect(response.headers.get("cache-control")).toContain("s-maxage=86400");
    expect(response.headers.get("cache-control")).toContain("max-age=0");
  });
});
