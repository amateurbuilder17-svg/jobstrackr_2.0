import { describe, expect, it } from "vitest";

import { CAPS, eligibleFor } from "./targets";

describe("eligibleFor", () => {
  it("sends both entity kinds to IndexNow", () => {
    expect(eligibleFor("indexnow", "job")).toBe(true);
    expect(eligibleFor("indexnow", "update")).toBe(true);
  });

  /**
   * The rule that protects the Google integration from being switched off.
   * Google sanctions the Indexing API for pages carrying JobPosting or
   * BroadcastEvent markup and says plainly that other use is grounds for
   * revoking access — which would be revoked silently, so nothing downstream
   * would catch this regression. Hence a test rather than a comment.
   */
  it("never sends an exam update to Google's Indexing API", () => {
    expect(eligibleFor("google", "job")).toBe(true);
    expect(eligibleFor("google", "update")).toBe(false);
  });
});

describe("CAPS", () => {
  it("leaves headroom under Google's 200-a-day project quota", () => {
    expect(CAPS.googleDaily).toBeLessThan(200);
  });

  it("spreads the daily allowance across more than one hourly run", () => {
    expect(CAPS.googlePerRun).toBeLessThan(CAPS.googleDaily);
  });

  it("stays well inside IndexNow's 10,000-per-request limit", () => {
    expect(CAPS.indexNowPerRun).toBeLessThanOrEqual(10_000);
  });
});
