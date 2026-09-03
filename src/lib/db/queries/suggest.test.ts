import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The add-exam typeahead's query.
 *
 * Two things are worth pinning down here, and neither is visible from the
 * contract test:
 *
 *   1. what it costs — a term under the threshold must not reach Postgres at
 *      all, because the whole design rests on one query per *search* rather
 *      than one per keystroke;
 *   2. what it ranks — an unranked match set ordered by closing date led "ssc"
 *      with NPCIL Kudankulam, which is what the scoring in `suggestSubjects`
 *      exists to fix. A regression there is invisible in production until
 *      somebody complains that the picker is useless.
 */

vi.mock("next/cache", () => ({
  cacheLife: () => undefined,
  cacheTag: () => undefined,
}));

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://suggest.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_suggest",
  NEXT_PUBLIC_SITE_URL: "https://jobstrackr.in",
  SUPABASE_SECRET_KEY: "sb_secret_suggest",
  REVALIDATE_SECRET: "r".repeat(64),
  CRON_SECRET: "c".repeat(64),
};

interface Row {
  id: string;
  title: string;
  last_date: string | null;
  organization: { short_name: string | null; name: string } | null;
}

let requests: URL[] = [];
let rows: Row[] = [];

const job = (id: string, title: string, last_date: string | null, org: string | null): Row => ({
  id,
  title,
  last_date,
  organization: org === null ? null : { short_name: org, name: org },
});

beforeAll(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
});

beforeEach(() => {
  requests = [];
  rows = [];
  vi.stubGlobal("fetch", (input: string | URL | Request) => {
    const href =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push(new URL(href));
    return Promise.resolve(
      new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function subject() {
  return import("./attempts");
}

describe("normalizeSuggestTerm", () => {
  it("folds case, punctuation and spacing into one cache key", async () => {
    const { normalizeSuggestTerm } = await subject();

    // These are the same search typed three ways. Treating them as three would
    // triple the queries and the cache entries for no gain.
    expect(normalizeSuggestTerm("SSC  CGL")).toBe("ssc cgl");
    expect(normalizeSuggestTerm(" ssc-cgl ")).toBe("ssc cgl");
    expect(normalizeSuggestTerm("SSC, CGL!")).toBe("ssc cgl");
  });

  it("bounds the key, so a pasted paragraph cannot mint a huge cache entry", async () => {
    const { normalizeSuggestTerm } = await subject();
    expect(normalizeSuggestTerm("a".repeat(500)).length).toBeLessThanOrEqual(48);
  });
});

describe("what reaches Postgres", () => {
  it("sends nothing for a term under the threshold", async () => {
    const { suggestSubjects, SUGGEST_MIN_CHARS } = await subject();

    const short = "a".repeat(SUGGEST_MIN_CHARS - 1);
    await expect(suggestSubjects(short)).resolves.toEqual([]);
    expect(requests, "a short term must not cost a query").toHaveLength(0);
  });

  it("sends nothing for punctuation that normalises away", async () => {
    const { suggestSubjects } = await subject();

    await expect(suggestSubjects("!!!  ---")).resolves.toEqual([]);
    expect(requests).toHaveLength(0);
  });

  it("issues exactly one bounded query for a real term", async () => {
    const { suggestSubjects } = await subject();

    await suggestSubjects("ssc cgl");

    expect(requests).toHaveLength(1);
    expect(requests[0]?.searchParams.get("limit")).toBe("24");
    expect(requests[0]?.searchParams.get("status")).toBe("eq.published");
  });

  it("leaves the last token open as a prefix, so a half-typed word still matches", async () => {
    const { suggestSubjects } = await subject();

    await suggestSubjects("upsc civ");

    const filter = requests[0]?.searchParams.get("search_vector") ?? "";
    // `websearch` has no prefix operator; this must be a plain tsquery.
    expect(filter).toContain("fts(jt_search)");
    expect(filter).toContain("upsc & civ:*");
  });
});

describe("what comes back", () => {
  it("puts the exam the user is typing above an incidental match", async () => {
    const { suggestSubjects } = await subject();

    rows = [
      // Closes latest, so an unranked `last_date desc` would lead with it.
      job(
        "a",
        "NPCIL Kudankulam Recruitment 2026 - Stipendiary Trainee",
        "2027-07-13",
        "NPCIL",
      ),
      job("b", "SSC CGL Recruitment 2026 Notification Out", "2027-06-02", "SSC"),
    ];

    const [first] = await suggestSubjects("ssc");
    expect(first?.title).toContain("SSC CGL");
  });

  it("prefers the notification whose name holds the whole typed phrase", async () => {
    const { suggestSubjects } = await subject();

    rows = [
      job("a", "SSC Stenographer Recruitment 2026", "2027-04-26", "SSC"),
      job("b", "SSC CGL Recruitment 2026", "2026-01-01", "SSC"),
    ];

    const [first] = await suggestSubjects("ssc cgl");
    expect(first?.title).toContain("CGL");
  });

  it("leads with the current cycle when two years of one exam both match", async () => {
    const { suggestSubjects } = await subject();

    // The user's stated worry: adding last year's notification by mistake.
    // Equally relevant rows are separated by closing date, newest first.
    rows = [
      job("old", "RRB ALP Recruitment 2025", "2025-05-11", "RRB"),
      job("new", "RRB ALP Recruitment 2026", "2027-05-11", "RRB"),
    ];

    const picked = await suggestSubjects("rrb alp");
    expect(picked[0]?.title).toBe("RRB ALP Recruitment 2026");
    // Both are still offered — somebody tracking last year's result needs it.
    expect(picked).toHaveLength(2);
  });

  it("offers one row for a posting scraped from two sources", async () => {
    const { suggestSubjects } = await subject();

    // `merge_duplicate_jobs` only collapses within an organisation, so the same
    // notification really does survive twice under two different bodies.
    rows = [
      job("a", "RRB ALP (CEN 01/2026) Recruitment 2026", "2027-05-15", "Ministry of Railways"),
      job("b", "RRB ALP (CEN 01/2026) Recruitment 2026", "2027-05-11", "RRB"),
    ];

    await expect(suggestSubjects("rrb alp")).resolves.toHaveLength(1);
  });

  it("never returns more than the visible list", async () => {
    const { suggestSubjects, SUGGEST_LIMIT } = await subject();

    rows = Array.from({ length: 24 }, (_, i) =>
      job(String(i), `SSC Recruitment ${String(2026 - i)}`, "2027-01-01", "SSC"),
    );

    await expect(suggestSubjects("ssc")).resolves.toHaveLength(SUGGEST_LIMIT);
  });

  it("carries the closing date, which is what tells two cycles apart", async () => {
    const { suggestSubjects } = await subject();

    rows = [job("a", "SSC CGL Recruitment 2026", "2027-06-02", "SSC")];

    const [only] = await suggestSubjects("ssc cgl");
    expect(only).toEqual({
      jobId: "a",
      title: "SSC CGL Recruitment 2026",
      organization: "SSC",
      lastDate: "2027-06-02",
    });
  });
});
