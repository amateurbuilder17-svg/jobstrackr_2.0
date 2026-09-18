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
async function attempts() {
  return import("./attempts");
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
    ["listJobs (search)", false, async () => (await jobs()).listJobs({ query: "engineer" })],
    ["getJobBySlug", true, async () => (await jobs()).getJobBySlug("ssc-cgl-2026")],
    ["listJobSlugs", false, async () => (await jobs()).listJobSlugs()],
    ["listRelatedJobs", false, async () => (await jobs()).listRelatedJobs("ssc", "x")],
    ["listOpenJobsMatching", false, async () => (await jobs()).listOpenJobsMatching("SSC")],
    ["listExamUpdates", false, async () => (await updates()).listExamUpdates()],
    ["getExamUpdateBySlug", true, async () => (await updates()).getExamUpdateBySlug("s")],
    ["listExamUpdateSlugs", false, async () => (await updates()).listExamUpdateSlugs()],
    ["listUpdatesForJob", false, async () => (await updates()).listUpdatesForJob("id")],
    ["listRelatedUpdates", false, async () => (await updates()).listRelatedUpdates("SSC", "x")],
    [
      "listLatestInCategory",
      false,
      async () => (await updates()).listLatestInCategory("result"),
    ],
    [
      "listExamUpdates (search)",
      false,
      async () => (await updates()).listExamUpdates({ query: "result" }),
    ],
    ["suggestSubjects", false, async () => (await attempts()).suggestSubjects("ssc cgl")],
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
    ["listOpenJobsMatching", async () => (await jobs()).listOpenJobsMatching("SSC")],
    ["listExamUpdates", async () => (await updates()).listExamUpdates()],
    ["getExamUpdateBySlug", async () => (await updates()).getExamUpdateBySlug("s")],
    ["listUpdatesForJob", async () => (await updates()).listUpdatesForJob("id")],
    ["listRelatedUpdates", async () => (await updates()).listRelatedUpdates("SSC", "x")],
    ["listLatestInCategory", async () => (await updates()).listLatestInCategory("result")],
    ["suggestSubjects", async () => (await attempts()).suggestSubjects("ssc cgl")],
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

/**
 * The contract above checks that every query is bounded and names its columns.
 * It cannot tell whether a filter was *applied* — a query that ignores its
 * search term satisfies both properties perfectly, which is exactly how
 * `listJobs` shipped for several modules with a search box that filtered
 * nothing. This asserts the term reaches the wire.
 */
describe("filters actually reach the query", () => {
  it("listJobs sends the search term to Postgres", async () => {
    await (await jobs()).listJobs({ query: "nurse" });

    const search = requests.find((u) => u.searchParams.has("search_vector"));
    expect(search, "no full-text filter was sent").toBeDefined();
    expect(search?.searchParams.get("search_vector")).toContain("nurse");
  });

  it("a single character sends no filter, rather than an empty result", async () => {
    // Mid-typing should not blank the page, so one character is treated as no
    // filter at all — the query must go out without a search predicate.
    await (await jobs()).listJobs({ query: "n" });

    const search = requests.find((u) => u.searchParams.has("search_vector"));
    expect(search, "a one-character term should not filter").toBeUndefined();
  });

  it("listLatestInCategory filters to its category", async () => {
    // The rail's whole claim is "these are results". A query that dropped the
    // predicate would still be bounded, still name its columns, and still
    // render — as the newest updates of any kind under a heading saying
    // otherwise.
    await (await updates()).listLatestInCategory("admit_card");

    const req = requests[0];
    expect(req?.searchParams.get("category")).toBe("eq.admit_card");
    expect(req?.searchParams.get("is_published")).toBe("eq.true");
  });

  it("listOpenJobsMatching sends both the term and the open-listing bound", async () => {
    // Two predicates, and the second is the one worth asserting: this rail is
    // headed "open vacancies", so a missing `last_date` filter would put closed
    // listings under a promise that they are not.
    await (await jobs()).listOpenJobsMatching("SSC");

    const req = requests[0];
    expect(req?.searchParams.get("search_vector")).toContain("SSC");
    expect(req?.searchParams.get("last_date")).toMatch(/^gte\.\d{4}-\d{2}-\d{2}$/);
    expect(req?.searchParams.get("status")).toBe("eq.published");
  });

  it("listExamUpdates matches a two-word search as prefixes", async () => {
    // "ssc steno" has to reach "SSC Stenographer". As a whole-word websearch
    // it went out as `'ssc' & 'steno'` and matched nothing in production.
    await (await updates()).listExamUpdates({ query: "ssc steno" });

    const search = requests.find((u) => u.searchParams.has("search_vector"));
    expect(search?.searchParams.get("search_vector")).toBe("fts(jt_search).ssc:* & steno:*");
  });

  it("listJobs sends the tag filter", async () => {
    await (await jobs()).listJobs({ tag: "banking" });
    const tagged = requests.find((u) => u.searchParams.has("tags"));
    expect(tagged, "no tag filter was sent").toBeDefined();
  });
});

/**
 * "Published" does not mean "open" on its own.
 *
 * The invariant that makes an ascending sort on `last_date` mean "closing
 * soon" is maintained by `close_expired_jobs()`, which the ingest worker calls
 * — so it is true only for as long as ingestion keeps running. When it lapses,
 * the ascending sort surfaces the *most* expired listings first, and the home
 * page leads with a row of jobs whose badges all read "Closed". That is how it
 * was found: 14 of 240 seeded rows were past their date and six of them owned
 * the top of the page.
 *
 * These assert the query refuses expired rows itself, so the feed degrades to
 * "slightly stale" rather than "confidently wrong" when the worker stops.
 */
describe("open-job lists exclude expired rows without help from the worker", () => {
  /** The `last_date=gte.YYYY-MM-DD` predicate PostgREST receives, if any. */
  function deadlineFloor(): string | undefined {
    const url = requests.find((u) =>
      (u.searchParams.get("last_date") ?? "").startsWith("gte."),
    );
    return url?.searchParams.get("last_date")?.slice("gte.".length);
  }

  it("listJobs filters out deadlines that have already passed", async () => {
    await (await jobs()).listJobs({ sort: "closing" });
    expect(deadlineFloor(), "no deadline floor was sent").toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("applies to the newest sort too — a closed job is closed either way", async () => {
    await (await jobs()).listJobs({ sort: "newest" });
    expect(deadlineFloor(), "no deadline floor was sent").toBeDefined();
  });

  it("listHighestVacancy filters out deadlines that have already passed", async () => {
    await (await jobs()).listHighestVacancy(8);
    expect(deadlineFloor(), "no deadline floor was sent").toBeDefined();
  });

  /**
   * IST, matching `close_expired_jobs()`. A UTC date retires a listing five and
   * a half hours early for the people it is written for — between 18:30 and
   * midnight IST the two would disagree about what "today" is.
   */
  it("uses the Indian date, not the UTC one", async () => {
    vi.setSystemTime(new Date("2026-03-09T20:00:00Z")); // 01:30 on the 10th, IST
    await (await jobs()).listJobs({ sort: "closing" });
    expect(deadlineFloor()).toBe("2026-03-10");
    vi.useRealTimers();
  });
});

/**
 * The job page's "Documents" rail reads `download_links` off the updates
 * attached to that job. It was the one render path that accepted a stored URL
 * on an `http` prefix alone, without `toUrl` — so a WhatsApp invite or a `t.me`
 * channel on an update would have been published on the job page, under a
 * heading that presents it as an official document.
 *
 * No production row carries one today, which is why nothing caught it. The
 * guarantee has to come from a test rather than from the current contents of
 * the table, because a scraper rewrites that column on every ingest.
 */
describe("listUpdateLinksForJob", () => {
  function respondWith(rows: unknown) {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(JSON.stringify(rows), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
  }

  it("never publishes a blocked destination as a document", async () => {
    respondWith([
      {
        title: "SSC CGL Admit Card 2026",
        category: "admit_card",
        detail: {
          download_links: [
            { label: "Download admit card", url: "https://ssc.gov.in/admit.pdf" },
            { label: "Join our channel", url: "https://t.me/examalerts" },
            { label: "Updates group", url: "https://chat.whatsapp.com/abc" },
            { label: "Read more", url: "https://www.freejobalert.com/ssc/" },
          ],
        },
      },
    ]);

    const [group] = await (await updates()).listUpdateLinksForJob("job-id");
    expect(group?.links.map((l) => l.url)).toEqual(["https://ssc.gov.in/admit.pdf"]);
  });

  it("names a link the source called 'Click here', using the update's category", async () => {
    respondWith([
      {
        title: "SSC CGL Result 2026",
        category: "result",
        detail: { download_links: [{ label: "Click here", url: "https://ssc.gov.in/x/y" }] },
      },
    ]);

    const [group] = await (await updates()).listUpdateLinksForJob("job-id");
    expect(group?.links[0]?.label).toBe("Result link");
  });

  it("drops a whole update once nothing on it survives", async () => {
    respondWith([
      {
        title: "Promo only",
        category: "news",
        detail: { download_links: [{ label: "Join", url: "https://t.me/x" }] },
      },
    ]);

    expect(await (await updates()).listUpdateLinksForJob("job-id")).toEqual([]);
  });
});

/**
 * A closed listing keeps its URL.
 *
 * `close_expired_jobs()` moves a job to `status = 'closed'` within an hour of
 * its deadline. Migration 0016 widened the RLS policies to `('published',
 * 'closed')` so the detail page would keep resolving, and wrote down why —
 * "~5,200 of these slugs are indexed, and a 404 on every expired notice would
 * throw away the crawl surface this rebuild exists to protect."
 *
 * `getJobBySlug` never widened with it. So the permission sat unused and every
 * expired notice 404'd: measured against production on 9 Sep 2026, 3,753 closed
 * rows against 3,046 published — more than half the corpus returning 404 to
 * Google and to anyone holding a bookmark or a forwarded link.
 *
 * The failure is invisible from inside the app. Nothing errors, no test broke,
 * and the pages 404 one at a time as their dates pass, so there is no moment
 * where it looks like a regression. These two assertions are the alarm: one
 * that the detail page still admits closed rows, one that the lists still
 * refuse them, because the fix for the first is one careless edit away from
 * breaking the second.
 */
describe("closed jobs resolve on their own page and nowhere else", () => {
  /** The `status` predicate PostgREST received on the last matching request. */
  function statusFilter(path: string): string | undefined {
    return (
      requests.find((u) => u.pathname.endsWith(path))?.searchParams.get("status") ?? undefined
    );
  }

  it("getJobBySlug accepts a closed listing", async () => {
    await (await jobs()).getJobBySlug("ssc-cgl-2026");

    const status = statusFilter("/jobs");
    expect(status, "no status filter was sent at all").toBeDefined();
    expect(status, "a closed job's page must still resolve — see migration 0016").toContain(
      "closed",
    );
  });

  it("the sitemap lists closed listings too, so they get recrawled", async () => {
    await (await jobs()).listJobSlugs();
    expect(statusFilter("/jobs")).toContain("closed");
  });

  it("but the feed still refuses them — a list is what you can apply to", async () => {
    await (await jobs()).listJobs({});
    expect(statusFilter("/jobs")).toBe("eq.published");
  });

  it("and so does the prerender list, which prices the build", async () => {
    await (await jobs()).listJobSlugsForBuild();
    expect(statusFilter("/jobs")).toBe("eq.published");
  });
});
