import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getServerEnv = vi.fn();
vi.mock("@/lib/env.server", () => ({ getServerEnv }));

const { GET } = await import("./route");

const KEY = "0123456789abcdef0123456789abcdef";

function request(key: string): NextRequest {
  return new NextRequest(`https://jobstrackr.in/api/seo/indexnow-key?key=${key}`);
}

/**
 * This route is the whole of IndexNow's ownership check. If it answers wrongly
 * the failure is not an error anyone sees — it is a 403 from the submission
 * endpoint, hours later, with every URL in the batch silently discarded.
 */
describe("GET /api/seo/indexnow-key", () => {
  beforeEach(() => {
    getServerEnv.mockReturnValue({ INDEXNOW_KEY: KEY });
  });

  it("serves the key back, as plain text, when the path matches it", async () => {
    const response = GET(request(KEY));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    await expect(response.text()).resolves.toBe(KEY);
  });

  it("is a 404 for a near-miss, so it cannot be used to guess the key", () => {
    const response = GET(request(`${KEY.slice(0, -1)}0`));
    expect(response.status).toBe(404);
  });

  it("is a 404 when no key is configured, rather than serving an empty file", () => {
    // An empty 200 would be worse than absent: IndexNow would fetch it,
    // find no key, and reject submissions with a status that says nothing
    // about the environment variable being unset.
    getServerEnv.mockReturnValue({ INDEXNOW_KEY: undefined });
    expect(GET(request(KEY)).status).toBe(404);
  });
});
