import { describe, expect, it } from "vitest";

import type { TieredJob } from "@/lib/db/queries/match";
import { buildShelves, countTiers } from "./shelves";

/**
 * The shelves.
 *
 * The old app's `buildFeed` had one property worth preserving above all others
 * and no test for it: a job appears in at most one shelf. Without that, "closing
 * soon" under "matches for you" is the same six cards again and the reader
 * learns to scroll past both.
 */

const TODAY = "2026-08-29";

function job(overrides: Partial<TieredJob> & Pick<TieredJob, "id">): TieredJob {
  return {
    slug: overrides.id,
    title: `Post ${overrides.id}`,
    location: null,
    state: null,
    last_date: "2026-12-31",
    last_date_display: null,
    vacancies: null,
    vacancies_display: null,
    qualification_summary: null,
    salary_min: null,
    salary_max: null,
    salary_display: null,
    application_fee: null,
    tags: [],
    is_featured: false,
    published_at: "2026-08-01T00:00:00Z",
    organization: null,
    tier: "can_apply",
    reasons: [],
    gaps: [],
    tier_total: 1,
    ...overrides,
  };
}

const CONTEXT = { today: TODAY, state: null, preferredStates: [] as string[] };

describe("countTiers", () => {
  it("reports the tier's own total, not the number of rows returned", () => {
    // `match_feed` caps each tier, so counting the array would tell someone
    // they have 36 matches when they have 200.
    const counts = countTiers([
      job({ id: "a", tier: "can_apply", tier_total: 200 }),
      job({ id: "b", tier: "can_apply", tier_total: 200 }),
      job({ id: "c", tier: "review", tier_total: 9 }),
    ]);
    expect(counts.can_apply).toBe(200);
    expect(counts.review).toBe(9);
  });

  it("reports zero for a tier with no rows", () => {
    expect(countTiers([]).blocked).toBe(0);
  });
});

describe("buildShelves", () => {
  it("puts every match in the first shelf when there are few of them", () => {
    const shelves = buildShelves([job({ id: "a" }), job({ id: "b" })], CONTEXT);
    expect(shelves).toHaveLength(1);
    expect(shelves[0]?.key).toBe("matches");
    expect(shelves[0]?.jobs.map((j) => j.id)).toEqual(["a", "b"]);
  });

  it("never repeats a job across shelves", () => {
    // The load-bearing property. Twenty-five matches, all closing this week and
    // all large: the first shelf takes twenty, and the narrow shelves must draw
    // only from the five it left.
    const rows = Array.from({ length: 25 }, (_, i) =>
      job({ id: `j${String(i)}`, last_date: "2026-09-02", vacancies: 500 }),
    );
    const shelves = buildShelves(rows, CONTEXT);
    const ids = shelves.flatMap((s) => s.jobs.map((j) => j.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("omits a shelf rather than rendering an empty heading", () => {
    const shelves = buildShelves([job({ id: "a", last_date: "2027-06-01" })], CONTEXT);
    expect(shelves.map((s) => s.key)).not.toContain("closing");
  });

  it("puts a deadline inside a week on the closing shelf", () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => job({ id: `filler${String(i)}` })),
      job({ id: "urgent", last_date: "2026-09-01" }),
    ];
    const shelves = buildShelves(rows, CONTEXT);
    expect(shelves.find((s) => s.key === "closing")?.jobs.map((j) => j.id)).toEqual(["urgent"]);
  });

  it("treats a job with no deadline as not closing soon", () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => job({ id: `filler${String(i)}` })),
      job({ id: "undated", last_date: null }),
    ];
    expect(buildShelves(rows, CONTEXT).map((s) => s.key)).not.toContain("closing");
  });

  it("builds the state shelf from the home state as well as the preferred ones", () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => job({ id: `filler${String(i)}` })),
      job({ id: "kerala", state: "Kerala" }),
    ];
    const shelves = buildShelves(rows, { ...CONTEXT, state: "Kerala" });
    expect(shelves.find((s) => s.key === "state")?.jobs.map((j) => j.id)).toEqual(["kerala"]);
  });

  it("does not treat 'All India' as a state preference", () => {
    // It is on the states list for the /jobs filter, and selecting it here
    // would build a shelf that duplicates the main one.
    const shelves = buildShelves([job({ id: "a" })], {
      ...CONTEXT,
      preferredStates: ["All India"],
    });
    expect(shelves.map((s) => s.key)).not.toContain("state");
  });

  it("orders the large-recruitment shelf by vacancy count", () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => job({ id: `filler${String(i)}` })),
      job({ id: "small", vacancies: 120 }),
      job({ id: "huge", vacancies: 5000 }),
    ];
    const shelf = buildShelves(rows, CONTEXT).find((s) => s.key === "vacancies");
    expect(shelf?.jobs.map((j) => j.id)).toEqual(["huge", "small"]);
  });

  it("keeps a three-gap job out of 'one skill away' but not out of the count", () => {
    // The old app's threshold: one or two gaps is close, five is a different
    // job. The counter still says four, because the tier still holds it.
    const rows = [
      job({ id: "near", tier: "skills_gap", gaps: ["skill:computer"], tier_total: 2 }),
      job({
        id: "far",
        tier: "skills_gap",
        gaps: ["skill:computer", "skill:autocad", "skill:gis"],
        tier_total: 2,
      }),
    ];
    const shelves = buildShelves(rows, CONTEXT);
    expect(shelves.find((s) => s.key === "skills")?.jobs.map((j) => j.id)).toEqual(["near"]);
    expect(countTiers(rows).skills_gap).toBe(2);
  });

  it("asks the skills shelf to render its gaps, and the match shelves not to", () => {
    const shelves = buildShelves(
      [job({ id: "a" }), job({ id: "b", tier: "skills_gap", gaps: ["skill:computer"] })],
      CONTEXT,
    );
    expect(shelves.find((s) => s.key === "matches")?.showGaps).toBeFalsy();
    expect(shelves.find((s) => s.key === "skills")?.showGaps).toBe(true);
  });

  it("never shelves a blocked job", () => {
    // Blocked rows are rendered in their own collapsed section, as blocked.
    // Any path that lets one into a shelf is a false positive.
    const shelves = buildShelves(
      [job({ id: "no", tier: "blocked", gaps: ["age:21-30|40"] })],
      CONTEXT,
    );
    expect(shelves.flatMap((s) => s.jobs)).toHaveLength(0);
  });

  it("never shelves a review job either", () => {
    const shelves = buildShelves(
      [job({ id: "maybe", tier: "review", gaps: ["unstated:level"] })],
      CONTEXT,
    );
    expect(shelves.flatMap((s) => s.jobs)).toHaveLength(0);
  });

  it("returns nothing at all for an empty feed", () => {
    expect(buildShelves([], CONTEXT)).toEqual([]);
  });
});
