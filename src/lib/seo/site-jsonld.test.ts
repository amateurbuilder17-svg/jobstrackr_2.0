import { describe, expect, it } from "vitest";

import { breadcrumbJsonLd, websiteJsonLd } from "./site-jsonld";

const site = "https://jobstrackr.in";

describe("breadcrumbJsonLd", () => {
  it("numbers positions from one", () => {
    const crumbs = breadcrumbJsonLd(site, [
      { name: "Jobs", path: "/jobs" },
      { name: "SSC CGL" },
    ]).itemListElement as { position: number }[];
    expect(crumbs.map((c) => c.position)).toEqual([1, 2]);
  });

  /**
   * The rule schema.org states and validators enforce: the page you are already
   * on is not somewhere to navigate to. Giving the last crumb an `item` is the
   * usual way this markup ends up flagged as invalid.
   */
  it("gives the final crumb no item URL", () => {
    const crumbs = breadcrumbJsonLd(site, [
      { name: "Jobs", path: "/jobs" },
      { name: "SSC CGL" },
    ]).itemListElement as Record<string, unknown>[];
    expect(crumbs[0]?.item).toBe(`${site}/jobs`);
    expect(crumbs[1]).not.toHaveProperty("item");
  });
});

describe("websiteJsonLd", () => {
  it("declares a search template Google can substitute into", () => {
    const action = websiteJsonLd(site).potentialAction as {
      target: { urlTemplate: string };
      "query-input": string;
    };
    expect(action.target.urlTemplate).toContain("{search_term_string}");
    expect(action["query-input"]).toBe("required name=search_term_string");
  });
});
