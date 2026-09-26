import { describe, expect, it } from "vitest";

import type { ExamUpdateDetail } from "@/lib/db/queries/exam-updates";

import { examUpdateJsonLd } from "./update-jsonld";

const SITE = "https://www.jobstrackr.in";

function update(overrides: Partial<ExamUpdateDetail>): ExamUpdateDetail {
  return {
    id: "u1",
    slug: "ssc-cgl-result-2026",
    title: "SSC CGL Result 2026",
    category: "result",
    summary: null,
    tags: [],
    published_date: "2026-09-22",
    published_at: "2026-09-22T10:00:00+00:00",
    scraped_at: null,
    source_url: "https://ssc.gov.in/result",
    job_id: null,
    job_link_state: "unlinked",
    exam: null,
    organization: null,
    detail: null,
    ...overrides,
  } as ExamUpdateDetail;
}

/**
 * `isBasedOn` is a link like any other, so it follows the rule every link in
 * the app does: it never names the aggregator (`lib/sync/links.ts`).
 */
describe("examUpdateJsonLd", () => {
  it("names the page an update was transcribed from", () => {
    expect(examUpdateJsonLd(update({}), SITE).isBasedOn).toBe("https://ssc.gov.in/result");
  });

  it("leaves isBasedOn out rather than naming freejobalert", () => {
    const ld = examUpdateJsonLd(
      update({
        source_url: "https://www.freejobalert.com/articles/ssc-cgl-result-2026-3041843",
      }),
      SITE,
    );
    expect(ld).not.toHaveProperty("isBasedOn");
    expect(JSON.stringify(ld)).not.toMatch(/freejobalert/i);
  });
});
