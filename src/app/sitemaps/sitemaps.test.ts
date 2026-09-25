import type * as NextServer from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as Hubs from "@/lib/db/queries/hubs";
import type { HubCensus } from "@/lib/db/queries/hubs";

vi.mock("@/lib/env", () => ({ env: { NEXT_PUBLIC_SITE_URL: "https://www.jobstrackr.in" } }));
// `connection()` needs a request scope; the routes call it only to opt out of
// prerendering, which is not what these tests are about.
vi.mock("next/server", async (original) => ({
  ...(await original<typeof NextServer>()),
  connection: () => Promise.resolve(),
}));

const listJobSlugs = vi.fn();
const getHubCensus = vi.fn();
vi.mock("@/lib/db/queries/jobs", () => ({ listJobSlugs }));
// The real `censusIndexable`, so the sitemap is tested against the same rule
// the hubs apply to their own robots meta; only the database read is faked.
vi.mock("@/lib/db/queries/hubs", async (original) => ({
  ...(await original<typeof Hubs>()),
  getHubCensus,
}));
vi.mock("@/lib/db/queries/syllabus", () => ({
  listSyllabusSlugs: () => Promise.resolve([]),
}));

const jobs = await import("./jobs.xml/route");
const pages = await import("./pages.xml/route");
const index = await import("../sitemap.xml/route");

beforeEach(() => {
  listJobSlugs.mockReset();
  getHubCensus.mockReset();
});

/**
 * The failure these routes exist to end: on 25 Sep 2026 the live sitemap was
 * still the file the 22 Sep build wrote, and nothing published since was in
 * it. Each request must read the database, so the only thing that can hold an
 * old list is the CDN, for as long as `s-maxage` says.
 */
describe("/sitemaps/jobs.xml", () => {
  it("lists a job the moment it is in the database", async () => {
    listJobSlugs.mockResolvedValueOnce([
      { slug: "ssc-cgl-2026", updated_at: "2026-09-20T10:00:00.000Z", closed: false },
    ]);
    listJobSlugs.mockResolvedValueOnce([
      { slug: "ssc-cgl-2026", updated_at: "2026-09-20T10:00:00.000Z", closed: false },
      {
        slug: "kvs-computer-instructor-2026",
        updated_at: "2026-09-23T06:00:00.000Z",
        closed: false,
      },
    ]);

    const before = await (await jobs.GET()).text();
    const after = await (await jobs.GET()).text();

    expect(before).not.toContain("kvs-computer-instructor-2026");
    expect(after).toContain(
      "<loc>https://www.jobstrackr.in/jobs/kvs-computer-instructor-2026</loc>",
    );
    expect(listJobSlugs).toHaveBeenCalledTimes(2);
  });

  it("weights a closed listing below an open one", async () => {
    listJobSlugs.mockResolvedValue([
      { slug: "open", updated_at: "2026-09-20T10:00:00.000Z", closed: false },
      { slug: "closed", updated_at: "2026-09-10T10:00:00.000Z", closed: true },
    ]);

    const xml = await (await jobs.GET()).text();

    expect(xml).toMatch(
      /jobs\/open<\/loc>\n<lastmod>[^<]+<\/lastmod>\n<changefreq>weekly<\/changefreq>\n<priority>0\.8<\/priority>/,
    );
    expect(xml).toMatch(
      /jobs\/closed<\/loc>\n<lastmod>[^<]+<\/lastmod>\n<changefreq>yearly<\/changefreq>\n<priority>0\.3<\/priority>/,
    );
  });

  it("is kept by the CDN for six hours", async () => {
    listJobSlugs.mockResolvedValue([]);
    const response = await jobs.GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=21600");
  });

  // An empty list cached for six hours would tell every engine in that window
  // the site has no job pages.
  it("answers 503, uncached, when the database cannot be read", async () => {
    listJobSlugs.mockRejectedValue(new Error("fetch failed"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await jobs.GET();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

/**
 * Nothing made only of updates asks to be indexed since 25 Sep 2026
 * (`lib/seo/indexing.ts`), and a sitemap URL whose page says `noindex` is the
 * contradiction Search Console reports as an error.
 */
describe("/sitemaps/pages.xml", () => {
  const census: HubCensus = {
    jobs: 40,
    updates: 90,
    byState: { Goa: 12 },
    bySector: {},
    byLevel: {},
    byUpdateCategory: { result: 30, admit_card: 25 },
    organisations: [
      { id: "o1", slug: "ibps", name: "IBPS", short_name: "IBPS", count: 20, indexable: 8 },
      // Plenty of updates and no jobs: its hub resolves for readers and says
      // `noindex`, so it must not be submitted.
      { id: "o2", slug: "ssc", name: "SSC", short_name: "SSC", count: 30, indexable: 0 },
    ],
  };

  it("leaves out every page made only of updates", async () => {
    getHubCensus.mockResolvedValue(census);
    const xml = await (await pages.GET()).text();

    expect(xml).not.toContain("<loc>https://www.jobstrackr.in/updates</loc>");
    expect(xml).not.toContain("/updates/page/");
    expect(xml).not.toContain("/categories/results");
    expect(xml).not.toContain("/categories/admit-cards");
  });

  it("lists an employer's hub on its jobs, not on its updates", async () => {
    getHubCensus.mockResolvedValue(census);
    const xml = await (await pages.GET()).text();

    expect(xml).toContain("<loc>https://www.jobstrackr.in/organisations/ibps</loc>");
    expect(xml).not.toContain("/organisations/ssc");
  });

  it("still lists the job hubs and the site's own pages", async () => {
    getHubCensus.mockResolvedValue(census);
    const xml = await (await pages.GET()).text();

    expect(xml).toContain("<loc>https://www.jobstrackr.in/jobs</loc>");
    expect(xml).toContain("<loc>https://www.jobstrackr.in/jobs/page/1</loc>");
    expect(xml).toContain("<loc>https://www.jobstrackr.in/states/goa</loc>");
  });
});

// `robots.txt` names this URL and Search Console already holds it, so it has
// to stay the entry point: an index that leads to each child.
describe("/sitemap.xml", () => {
  it("is an index of the page and job sitemaps, and no update sitemap", async () => {
    const xml = await index.GET().text();

    expect(xml).toContain("<sitemapindex");
    for (const child of ["pages", "jobs"]) {
      expect(xml).toContain(`<loc>https://www.jobstrackr.in/sitemaps/${child}.xml</loc>`);
    }
    expect(xml).not.toContain("updates.xml");
  });
});
