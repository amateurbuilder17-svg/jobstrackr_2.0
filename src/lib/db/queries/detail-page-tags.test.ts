import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The free-tier gate.
 *
 * Commit 949face is the reason this file exists. The job and update detail
 * pages were reading queries tagged `jobs:list` and `updates:list`; ingest
 * purges those on every run that writes, up to four times an hour, so all
 * ~7,000 detail pages went stale together and every crawler hit re-rendered one
 * and wrote a fresh ISR entry. The Hobby project ended the month at 744K ISR
 * writes against a 200K allowance, 73 GB of deployment storage against 10, and
 * over its Fast Origin Transfer and Active CPU ceilings as well.
 *
 * The fix was to give those queries per-entity tags. Nothing stopped the next
 * person reintroducing it — a rail is a list, `tags.examUpdateList()` is what a
 * list query obviously reaches for, and the failure is invisible in review and
 * in every test: the page renders correctly, it simply renders far too often.
 * The bill arrives three weeks later.
 *
 * So the rule is asserted rather than documented. Two properties, both about
 * what a *detail page* may inherit:
 *
 *   1. No query it awaits may carry a collection tag.
 *   2. No query it awaits may carry a lifetime shorter than `content`.
 *
 * The second is the subtler one. Next takes the most restrictive lifetime among
 * a cache entry and everything it depends on, so a single `cacheLife("feed")`
 * rail drags the whole page from a three-day revalidate to a six-hour one —
 * which is the same 744K-write arithmetic arriving by a different road.
 */

const recorded: { tags: string[]; lives: string[] } = { tags: [], lives: [] };

vi.mock("next/cache", () => ({
  cacheTag: (...tags: string[]) => {
    recorded.tags.push(...tags);
  },
  cacheLife: (profile: string) => {
    recorded.lives.push(profile);
  },
}));

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://tags.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_tags",
  NEXT_PUBLIC_SITE_URL: "https://jobstrackr.in",
  SUPABASE_SECRET_KEY: "sb_secret_tags",
  REVALIDATE_SECRET: "r".repeat(64),
  CRON_SECRET: "c".repeat(64),
};

beforeAll(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
});

beforeEach(() => {
  recorded.tags = [];
  recorded.lives = [];
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const jobs = () => import("./jobs");
const updates = () => import("./exam-updates");

/**
 * The tags ingest purges on every run that writes. See `/api/ingest`.
 * `sitemap` is kept in the list although ingest stopped purging it on 25 Sep
 * 2026: a detail page has no business carrying it either way.
 */
const CHURNING_TAGS = ["jobs:list", "updates:list", "sitemap"];

/**
 * Every read an update or job detail page awaits.
 *
 * Adding a rail to either page means adding its query here. That is the point:
 * the list is the checklist, and a new query left off it is a new query nobody
 * checked.
 */
const DETAIL_PAGE_QUERIES: [name: string, run: () => Promise<unknown>][] = [
  // /updates/[slug]
  ["getExamUpdateBySlug", async () => (await updates()).getExamUpdateBySlug("s")],
  ["listRelatedUpdates", async () => (await updates()).listRelatedUpdates("SSC", "s")],
  [
    "listLatestInCategory(result)",
    async () => (await updates()).listLatestInCategory("result"),
  ],
  [
    "listLatestInCategory(admit_card)",
    async () => (await updates()).listLatestInCategory("admit_card"),
  ],
  ["listOpenJobsMatching", async () => (await jobs()).listOpenJobsMatching("SSC")],
  // /jobs/[slug]
  ["getJobBySlug", async () => (await jobs()).getJobBySlug("ssc-cgl-2026")],
  ["listJobChanges", async () => (await jobs()).listJobChanges("job-id")],
  ["listRelatedJobs", async () => (await jobs()).listRelatedJobs("ssc", "x")],
  ["listUpdatesForJob", async () => (await updates()).listUpdatesForJob("job-id")],
  ["listUpdateLinksForJob", async () => (await updates()).listUpdateLinksForJob("job-id")],
];

describe("no detail-page query carries a tag ingest purges", () => {
  it.each(DETAIL_PAGE_QUERIES)("%s", async (name, run) => {
    await run();

    expect(recorded.tags.length, `${name} registered no cache tag at all`).toBeGreaterThan(0);

    for (const tag of recorded.tags) {
      expect(
        CHURNING_TAGS,
        `${name} carries "${tag}", which ingest purges on every write — ` +
          `every page reading it re-renders up to four times an hour`,
      ).not.toContain(tag);
    }
  });
});

describe("no detail-page query shortens the page's cache window", () => {
  it.each(DETAIL_PAGE_QUERIES)("%s uses the content profile", async (name, run) => {
    await run();

    expect(
      recorded.lives,
      `${name} declares no cacheLife, so it inherits the default rather than ` +
        `the three-day content window`,
    ).not.toHaveLength(0);

    for (const profile of recorded.lives) {
      expect(
        profile,
        `${name} uses "${profile}"; a profile shorter than "content" propagates ` +
          `to every page that awaits it`,
      ).toBe("content");
    }
  });
});

describe("the rails are keyed so pages share their cache entries", () => {
  /**
   * The property that makes the rails affordable at all.
   *
   * `"use cache"` keys on the function and its arguments. A rail keyed on a
   * category is one entry shared by all ~5,300 update pages — one Supabase read
   * per cache window for the whole corpus. Thread the current page's slug in to
   * exclude it and the same rail becomes 5,300 entries and 5,300 reads, which
   * is a 5,300-fold cost increase that looks, in a diff, like a bug fix.
   *
   * Asserted through the tag rather than the key, because the tag is derived
   * from the same argument and is the part that is observable here.
   */
  it("a category rail's tag names the category and nothing page-specific", async () => {
    await (await updates()).listLatestInCategory("result");
    expect(recorded.tags).toEqual(["update:rail-result"]);
  });

  it("the job rail's tag names the term, case-folded so SSC and ssc agree", async () => {
    await (await jobs()).listOpenJobsMatching("SSC");
    const upper = [...recorded.tags];

    recorded.tags = [];
    await (await jobs()).listOpenJobsMatching("ssc");

    expect(upper).toEqual(["job:term-ssc"]);
    expect(recorded.tags).toEqual(upper);
  });
});
