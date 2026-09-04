import { describe, expect, it } from "vitest";

import type { JobDetail } from "@/lib/db/queries/jobs";

/**
 * `job-jsonld.ts` reaches `@/lib/db/storage` at module scope, which refuses to
 * load without a project URL to build logo URLs against. A placeholder set
 * before the dynamic import below is enough — nothing here fetches anything.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";

const { jobPostingJsonLd } = await import("./job-jsonld");

const site = "https://jobstrackr.in";

/**
 * Only the fields `jobPostingJsonLd` reads. The real row is a `QueryData` of
 * the detail query — forty columns, thirty-odd of which this function never
 * touches — so it is narrowed here rather than reproduced.
 */
function job(overrides: Partial<JobDetail>): JobDetail {
  return {
    slug: "ssc-cgl-2026",
    title: "SSC CGL Recruitment 2026",
    state: null,
    location: null,
    vacancies: null,
    qualification_summary: null,
    salary_min: null,
    salary_max: null,
    organization: null,
    detail: null,
    ...overrides,
  } as unknown as JobDetail;
}

/**
 * Google drops the whole record on a bad field and, worse, prints a good-looking
 * one: a pay-matrix level published as `minValue: 2` becomes a job paying ₹2 a
 * month in a search result.
 */
describe("jobPostingJsonLd baseSalary", () => {
  it("publishes a real range", () => {
    const posting = jobPostingJsonLd(job({ salary_min: 25_500, salary_max: 81_100 }), site);
    expect(posting.baseSalary).toMatchObject({
      currency: "INR",
      value: { minValue: 25_500, maxValue: 81_100, unitText: "MONTH" },
    });
  });

  it("omits a pay-matrix level rather than publish ₹2", () => {
    expect(jobPostingJsonLd(job({ salary_min: 2, salary_max: 2 }), site)).not.toHaveProperty(
      "baseSalary",
    );
  });

  it("publishes the pay the level was misread from when the prose states it", () => {
    const posting = jobPostingJsonLd(
      job({
        salary_min: 2,
        salary_max: 2,
        detail: {
          salary_text: "Level-2 in 7th CPC Pay Matrix; Initial Pay Rs. 19,900/-",
        } as JobDetail["detail"],
      }),
      site,
    );
    expect(posting.baseSalary).toMatchObject({
      value: { minValue: 19_900, maxValue: 19_900 },
    });
  });
});
