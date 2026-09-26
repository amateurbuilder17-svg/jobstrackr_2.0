import { describe, expect, it } from "vitest";

import { CAPS, GOOGLE_LOOKBACK_MS, eligibleFor } from "./targets";

describe("eligibleFor", () => {
  it("sends job pages to IndexNow", () => {
    expect(eligibleFor("indexnow", "job")).toBe(true);
  });

  // Every update page answers `noindex` since 25 Sep 2026, and announcing one
  // spends a submission on a page Bing will refuse.
  it("sends no update page to IndexNow while updates are not indexed", () => {
    expect(eligibleFor("indexnow", "update")).toBe(false);
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

describe("GOOGLE_LOOKBACK_MS", () => {
  // Long enough to cover a weekend's outage, short enough that the daily quota
  // is spent on jobs people can still apply to.
  it("is two days", () => {
    expect(GOOGLE_LOOKBACK_MS).toBe(172_800_000);
  });
});
