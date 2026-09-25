import { describe, expect, it } from "vitest";

import {
  CHILD_SITEMAPS,
  SITEMAP_CDN_SECONDS,
  renderSitemapIndex,
  renderUrlset,
  sitemapResponse,
  sitemapUnavailable,
} from "./sitemap-xml";

describe("renderUrlset", () => {
  it("writes the shape Next's sitemap convention wrote", () => {
    const xml = renderUrlset([
      {
        url: "https://www.jobstrackr.in/jobs/ssc-cgl-2026",
        lastModified: new Date("2026-09-22T10:52:40.652Z"),
        changeFrequency: "weekly",
        priority: 0.8,
      },
      { url: "https://www.jobstrackr.in", changeFrequency: "daily", priority: 1 },
    ]);

    expect(xml).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        "<url>",
        "<loc>https://www.jobstrackr.in/jobs/ssc-cgl-2026</loc>",
        "<lastmod>2026-09-22T10:52:40.652Z</lastmod>",
        "<changefreq>weekly</changefreq>",
        "<priority>0.8</priority>",
        "</url>",
        "<url>",
        "<loc>https://www.jobstrackr.in</loc>",
        "<changefreq>daily</changefreq>",
        "<priority>1</priority>",
        "</url>",
        "</urlset>",
        "",
      ].join("\n"),
    );
  });

  // Slugs are `[a-z0-9-]`, so this never fires today. An unescaped `&` in one
  // <loc> would make the whole file malformed XML, and engines reject a
  // malformed sitemap outright rather than skipping the bad entry.
  it("escapes what XML reserves", () => {
    const xml = renderUrlset([{ url: "https://www.jobstrackr.in/jobs/a&b<c>" }]);
    expect(xml).toContain("<loc>https://www.jobstrackr.in/jobs/a&amp;b&lt;c&gt;</loc>");
  });

  it("is a valid empty urlset when there is nothing to list", () => {
    expect(renderUrlset([])).toContain("<urlset");
    expect(renderUrlset([])).toContain("</urlset>");
  });
});

describe("renderSitemapIndex", () => {
  it("lists every child, absolute", () => {
    const xml = renderSitemapIndex(CHILD_SITEMAPS.map((p) => `https://www.jobstrackr.in${p}`));

    expect(xml).toContain('<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    for (const path of CHILD_SITEMAPS) {
      expect(xml).toContain(`<loc>https://www.jobstrackr.in${path}</loc>`);
    }
    expect(xml.match(/<sitemap>/g)).toHaveLength(CHILD_SITEMAPS.length);
  });
});

describe("sitemapResponse", () => {
  /**
   * The CDN window is the whole freshness mechanism now. A response without
   * `s-maxage` would be rebuilt from the database on every crawler request;
   * one with a long window would recreate the frozen sitemap it replaced.
   */
  it("is kept by the CDN for the window it is given, and by nobody else", () => {
    const cache =
      sitemapResponse("<urlset/>", SITEMAP_CDN_SECONDS.jobs).headers.get("cache-control") ?? "";

    expect(cache).toContain("public");
    expect(cache).toMatch(/(^|[ ,])max-age=0(,|$)/);
    expect(cache).toContain("s-maxage=21600");
  });

  // Job pages are the ones Google hears about from no other channel, so their
  // file is the one that must not wait a day.
  it("gives the job sitemap six hours and the page sitemap a day", () => {
    expect(SITEMAP_CDN_SECONDS).toEqual({ jobs: 21_600, pages: 86_400 });
  });

  it("is served as XML", () => {
    expect(sitemapResponse("<urlset/>", 60).headers.get("content-type")).toContain(
      "application/xml",
    );
  });
});

describe("sitemapUnavailable", () => {
  // An empty file cached for six hours would tell every engine in that window
  // that the site has no pages of that kind.
  it("answers 503 and is never cached", () => {
    const response = sitemapUnavailable();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBeTruthy();
  });
});
