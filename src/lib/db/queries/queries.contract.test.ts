import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Module 2 gate.
 *
 * Asserts the two properties that, when violated, produced the outage this
 * rebuild is recovering from:
 *
 *   1. every query is bounded — it carries a LIMIT
 *   2. every query names its columns — no `select('*')`
 *
 * These are checked against the URLs actually sent to PostgREST rather than
 * against source text. A source-level check is easy to satisfy accidentally and
 * easy to fool on refactor — extracting a builder into a helper would hide a
 * missing LIMIT from any AST walk, while the request on the wire cannot lie.
 */

vi.mock("next/cache", () => ({
  cacheLife: () => undefined,
  cacheTag: () => undefined,
}));

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://contract.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_contract",
  NEXT_PUBLIC_SITE_URL: "https://jobstrackr.in",
  SUPABASE_SECRET_KEY: "sb_secret_contract",
  REVALIDATE_SECRET: "r".repeat(64),
  CRON_SECRET: "c".repeat(64),
};

let requests: URL[] = [];

beforeAll(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
});

beforeEach(() => {
  requests = [];
  vi.stubGlobal("fetch", (input: string | URL | Request) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push(new URL(url));
    return Promise.resolve(
      new Response("[]", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Every query call recorded so far, as {select, limit} pairs. */
function issued() {
  return requests.map((u) => ({
    path: u.pathname,
    select: u.searchParams.get("select") ?? "",
    limit: u.searchParams.get("limit"),
    href: u.href,
  }));
}

async function jobs() {
  return import("./jobs");
}
async function updates() {
  return import("./exam-updates");
}

describe("every query is bounded", () => {
  /**
   * Whether a query legitimately returns a single row. Declared here rather
   * than sniffed from the request URL: an earlier version inferred it from the
   * presence of `slug=eq.` in the href, which silently exempted every list
   * query that filtered by organization slug — so a genuinely unbounded query
   * passed. The flag is explicit now, and adding a query without one is a
   * type error rather than a quiet exemption.
   */
  const cases: [name: string, single: boolean, run: () => Promise<unknown>][] = [
    ["listJobs", false, async () => (await jobs()).listJobs()],
    ["getJobBySlug", true, async () => (await jobs()).getJobBySlug("ssc-cgl-2026")],
    ["listJobSlugs", false, async () => (await jobs()).listJobSlugs()],
    ["listRelatedJobs", false, async () => (await jobs()).listRelatedJobs("ssc", "x")],
    ["searchJobs", false, async () => (await jobs()).searchJobs("engineer")],
    ["listExamUpdates", false, async () => (await updates()).listExamUpdates()],
    ["getExamUpdateBySlug", true, async () => (await updates()).getExamUpdateBySlug("s")],
    ["listExamUpdateSlugs", false, async () => (await updates()).listExamUpdateSlugs()],
    ["listUpdatesForJob", false, async () => (await updates()).listUpdatesForJob("id")],
    ["searchExamUpdates", false, async () => (await updates()).searchExamUpdates("result")],
  ];

  it.each(cases)("%s sends a LIMIT", async (_name, single, run) => {
    await run();

    expect(requests.length).toBeGreaterThan(0);

    for (const req of issued()) {
      if (single) {
        // PostgREST bounds these via the Accept header, so no LIMIT is needed —
        // but the request must actually be a single-row fetch, not a list that
        // happens to be declared as one.
        expect(req.href, `${_name} declared single but is not a keyed lookup`).toMatch(
          /(^|[?&])(slug|id)=eq\./,
        );
        continue;
      }

      expect(req.limit, `unbounded query: ${req.href}`).not.toBeNull();
      expect(Number(req.limit)).toBeGreaterThan(0);
      expect(Number(req.limit)).toBeLessThanOrEqual(20001);
    }
  });
});

describe("every query names its columns", () => {
  it.each([
    ["listJobs", async () => (await jobs()).listJobs()],
    ["getJobBySlug", async () => (await jobs()).getJobBySlug("ssc-cgl-2026")],
    ["listRelatedJobs", async () => (await jobs()).listRelatedJobs("ssc", "x")],
    ["searchJobs", async () => (await jobs()).searchJobs("engineer")],
    ["listExamUpdates", async () => (await updates()).listExamUpdates()],
    ["getExamUpdateBySlug", async () => (await updates()).getExamUpdateBySlug("s")],
    ["listUpdatesForJob", async () => (await updates()).listUpdatesForJob("id")],
  ])("%s does not select *", async (_name, run) => {
    await run();

    for (const req of issued()) {
      expect(req.select, `select(*) in ${req.href}`).not.toBe("*");
      // A bare `*` as a whole path segment. Nested selects legitimately contain
      // parentheses and commas, so this checks segments rather than substrings.
      const segments = req.select.split(/[(),]/).map((s) => s.trim());
      expect(segments, `wildcard column in ${req.href}`).not.toContain("*");
      expect(req.select.length).toBeGreaterThan(0);
    }
  });
});

describe("list queries fetch one extra row for the cursor", () => {
  it("listJobs requests limit + 1", async () => {
    await (await jobs()).listJobs({ limit: 20 });
    expect(issued()[0]?.limit).toBe("21");
  });

  it("respects an explicit smaller page", async () => {
    await (await jobs()).listJobs({ limit: 5 });
    expect(issued()[0]?.limit).toBe("6");
  });
});

describe("card selects stay narrow", () => {
  it("a job card does not pull description or JSONB detail", async () => {
    await (await jobs()).listJobs();
    const select = issued()[0]?.select ?? "";

    for (const cold of ["description", "eligibility_profile", "raw", "job_details"]) {
      expect(select, `card select pulls cold column ${cold}`).not.toContain(cold);
    }
  });

  it("an update card does not pull the JSONB that made the old table 39 MB", async () => {
    await (await updates()).listExamUpdates();
    const select = issued()[0]?.select ?? "";

    for (const cold of ["sections", "download_links", "related_articles", "body", "raw"]) {
      expect(select, `card select pulls cold column ${cold}`).not.toContain(cold);
    }
  });
});
