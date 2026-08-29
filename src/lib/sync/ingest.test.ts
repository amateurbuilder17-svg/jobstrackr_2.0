import { describe, expect, it } from "vitest";

/**
 * `ingest.ts` reaches `@/lib/db/clients` at module scope, which validates the
 * public environment on import. These are placeholders, set before the dynamic
 * import below so they are in place when that runs — the alternative is a
 * global `test.env`, which would hand `env.test.ts` an environment it is
 * supposed to be asserting about. Nothing here connects to anything.
 */
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "sb_publishable_test";
process.env.NEXT_PUBLIC_SITE_URL ??= "https://test.invalid";

const { toJobPayload } = await import("./ingest");

/**
 * The feed row → `jobs` row mapping.
 *
 * Pure, so it is tested without a database. What is pinned here is the column
 * *naming*, which is where this mapping has actually gone wrong: the sheet and
 * the table disagree about what several fields are called, and a name the
 * mapper does not know produces a NULL rather than an error.
 */

/** The columns `toJobPayload` refuses to proceed without. */
const REQUIRED = {
  title: "SSC CGL Recruitment 2026",
  source_url: "https://www.freejobalert.com/ssc-cgl/",
  organization: "Staff Selection Commission",
};

const noOrganizations = () => undefined;

describe("toJobPayload", () => {
  it("reads the sheet's `qualification` into qualification_summary", () => {
    // The Jobs tab calls this column `qualification`. `min_qualification_level`
    // and `required_stream` are generated from `qualification_summary`, so a
    // miss here does not fail — it silently removes the job from matching.
    const { payload } = toJobPayload(
      { ...REQUIRED, qualification: "Bachelor's degree in any discipline" },
      noOrganizations,
    );

    expect(payload.qualification_summary).toBe("Bachelor's degree in any discipline");
  });

  it("prefers the new name when a row carries both", () => {
    const { payload } = toJobPayload(
      { ...REQUIRED, qualification: "old", qualification_summary: "new" },
      noOrganizations,
    );

    expect(payload.qualification_summary).toBe("new");
  });

  it("falls through a placeholder in the new name to the old one", () => {
    // A backfill row can carry `qualification_summary: "Not Available"`, which
    // `toText` reads as empty. Preferring it blindly would discard the real
    // answer sitting in the column beside it.
    const { payload } = toJobPayload(
      {
        ...REQUIRED,
        qualification: "ITI in any trade",
        qualification_summary: "Not Available",
      },
      noOrganizations,
    );

    expect(payload.qualification_summary).toBe("ITI in any trade");
  });

  it("does not publish a row with no closing date", () => {
    // What `buildJobRow` writes when it could not parse a deadline: "TBD" in
    // the date column, "Not Available" in the display one.
    // `jobs_published_has_essentials` would reject it, and a half-scraped
    // listing on the public site is worse than a draft in the admin table.
    const { payload } = toJobPayload(
      { ...REQUIRED, last_date: "TBD", last_date_display: "Not Available" },
      noOrganizations,
    );

    expect(payload.last_date).toBeNull();
    expect(payload.last_date_display).toBeNull();
    expect(payload.status).toBe("draft");
  });

  it("keeps a display date the sheet actually wrote", () => {
    const { payload } = toJobPayload(
      { ...REQUIRED, last_date: "TBD", last_date_display: "Third week of March" },
      noOrganizations,
    );

    expect(payload.last_date_display).toBe("Third week of March");
  });

  it("keeps the dedupe key stable when content changes", () => {
    // Identity is the source URL and the title, so a corrected salary updates
    // the row it belongs to rather than creating a second listing.
    const a = toJobPayload({ ...REQUIRED, salary_max: 81100 }, noOrganizations);
    const b = toJobPayload({ ...REQUIRED, salary_max: 92300 }, noOrganizations);

    expect(a.dedupeKey).toBe(b.dedupeKey);
  });
});
