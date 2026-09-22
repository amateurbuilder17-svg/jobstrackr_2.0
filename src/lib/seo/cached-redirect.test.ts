import { describe, expect, it } from "vitest";

import { cachedGone, cachedRedirect } from "./cached-redirect";

const request = new Request("https://www.jobstrackr.in/job/abc");

describe("cachedRedirect", () => {
  it("caches a resolved legacy URL at the CDN for a year", () => {
    const response = cachedRedirect(request, "/jobs/ssc-cgl-2026");

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://www.jobstrackr.in/jobs/ssc-cgl-2026",
    );
    expect(response.headers.get("cache-control")).toContain("s-maxage=31536000");
  });
});

describe("cachedGone", () => {
  /**
   * A miss used to be a 307 to the list page, and Google files many URLs
   * redirecting to one list as soft 404s. It must not be any kind of redirect.
   */
  it("answers a miss 410 Gone, not a redirect to the list", async () => {
    const response = cachedGone("job");

    expect(response.status).toBe(410);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain('href="/jobs"');
  });

  it("points an update miss at the updates list", async () => {
    expect(await cachedGone("update").text()).toContain('href="/updates"');
  });

  // A miss may only mean the row is not ingested yet, so it must not be pinned
  // at the edge for long.
  it("is cached for a day at the CDN and not at all in the browser", () => {
    const cache = cachedGone("job").headers.get("cache-control");

    expect(cache).toContain("s-maxage=86400");
    expect(cache).toContain("max-age=0");
  });
});
