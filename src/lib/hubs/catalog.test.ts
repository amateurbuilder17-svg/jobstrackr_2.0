import { describe, expect, it } from "vitest";

import { UPDATE_CATEGORIES } from "@/lib/updates/categories";
import { SECTORS } from "@/lib/vocab";

import {
  ALL_JOBS_HUB,
  ALL_UPDATES_HUB,
  BROWSE_LINKS,
  CATEGORY_HUBS,
  HUB_PAGE_SIZE,
  STATE_HUBS,
  categoryHub,
  hubPageCount,
  hubPagePath,
  organisationHub,
  pagerWindow,
  parsePageNumber,
  sectorHubPath,
  stateHub,
  toHubSlug,
  updateCategoryHubPath,
} from "./catalog";

describe("toHubSlug", () => {
  it("makes a path segment of a state name", () => {
    expect(toHubSlug("Andaman and Nicobar Islands")).toBe("andaman-and-nicobar-islands");
    expect(toHubSlug("Dadra and Nagar Haveli and Daman and Diu")).toBe(
      "dadra-and-nagar-haveli-and-daman-and-diu",
    );
    expect(toHubSlug("All India")).toBe("all-india");
  });

  it("spells out an ampersand", () => {
    expect(toHubSlug("Banking & insurance")).toBe("banking-and-insurance");
  });
});

describe("the catalogue", () => {
  it("gives every hub a distinct path and a distinct cache key", () => {
    const hubs = [...STATE_HUBS, ...CATEGORY_HUBS, ALL_JOBS_HUB, ALL_UPDATES_HUB];
    expect(new Set(hubs.map((h) => h.path)).size).toBe(hubs.length);
    expect(new Set(hubs.map((h) => h.key)).size).toBe(hubs.length);
  });

  it("has a hub for every state and union territory, and one for All India", () => {
    expect(STATE_HUBS).toHaveLength(37);
    expect(stateHub("uttar-pradesh")?.filter).toEqual({
      kind: "state",
      state: "Uttar Pradesh",
    });
    expect(stateHub("all-india")?.heading).toBe("All-India government jobs");
  });

  it("has a hub for every sector", () => {
    for (const { value } of SECTORS) {
      expect(sectorHubPath(value), value).toBe(`/categories/${value}`);
    }
  });

  /**
   * A recruitment notice answers `noindex` and restates a job page (see
   * `lib/seo/indexing.ts`); a hub listing them would be a page of links to
   * pages that refuse the index.
   */
  it("has a hub for every update category except recruitment notices", () => {
    for (const category of UPDATE_CATEGORIES) {
      if (category === "notification") expect(updateCategoryHubPath(category)).toBeUndefined();
      else expect(updateCategoryHubPath(category), category).toBeDefined();
    }
    expect(categoryHub("results")?.filter).toEqual({
      kind: "updateCategory",
      category: "result",
    });
  });

  it("has a hub for each qualification level", () => {
    expect(categoryHub("10th-pass")?.filter).toEqual({ kind: "level", level: "class_10" });
    expect(categoryHub("graduate")?.filter).toEqual({ kind: "level", level: "bachelor" });
  });

  it("knows nothing it was not given", () => {
    expect(stateHub("atlantis")).toBeUndefined();
    expect(categoryHub("notification")).toBeUndefined();
    expect(sectorHubPath("insurance")).toBeUndefined();
  });

  it("builds an organisation's hub from its row, preferring a distinct short name", () => {
    const hub = organisationHub({
      id: "o1",
      slug: "ssc",
      name: "Staff Selection Commission",
      short_name: "SSC",
    });
    expect(hub.path).toBe("/organisations/ssc");
    expect(hub.label).toBe("SSC");
    expect(hub.filter).toEqual({ kind: "organisation", organizationId: "o1" });

    const same = organisationHub({ id: "o2", slug: "x", name: "NABARD", short_name: "nabard" });
    expect(same.label).toBe("NABARD");
  });

  it("puts every browse link in the footer on a path the catalogue serves", () => {
    expect(BROWSE_LINKS.map((l) => l.href)).toEqual([
      "/organisations",
      "/states",
      "/categories",
      "/jobs/page/1",
      "/updates/page/1",
    ]);
  });
});

describe("hubPagePath", () => {
  it("leaves a hub's first page on its bare path", () => {
    const hub = { path: "/states/goa" };
    expect(hubPagePath(hub, 1)).toBe("/states/goa");
    expect(hubPagePath(hub, 3)).toBe("/states/goa/page/3");
  });

  it("numbers an archive's first page, which /jobs itself is not", () => {
    expect(hubPagePath(ALL_JOBS_HUB, 1)).toBe("/jobs/page/1");
    expect(hubPagePath(ALL_UPDATES_HUB, 2)).toBe("/updates/page/2");
  });
});

describe("hubPageCount", () => {
  it("rounds up, and gives an empty hub one page", () => {
    expect(hubPageCount(0)).toBe(1);
    expect(hubPageCount(HUB_PAGE_SIZE)).toBe(1);
    expect(hubPageCount(HUB_PAGE_SIZE + 1)).toBe(2);
  });
});

describe("parsePageNumber", () => {
  it("accepts a plain page number at or above the minimum", () => {
    expect(parsePageNumber("2", 2)).toBe(2);
    expect(parsePageNumber("1", 1)).toBe(1);
    expect(parsePageNumber("140", 2)).toBe(140);
  });

  it("refuses page 1 where the bare path is page 1", () => {
    expect(parsePageNumber("1", 2)).toBeNull();
  });

  // Each of these would be a second URL for a page that already has one.
  it("refuses every other spelling of a number", () => {
    for (const raw of ["02", "2.0", "+2", " 2", "2 ", "0", "-1", "1e1", "two", "", "99999"]) {
      expect(parsePageNumber(raw, 1), JSON.stringify(raw)).toBeNull();
    }
  });
});

describe("pagerWindow", () => {
  it("shows every page when there are few", () => {
    expect(pagerWindow(1, 1)).toEqual([1]);
    expect(pagerWindow(2, 4)).toEqual([1, 2, 3, 4]);
  });

  it("elides the runs away from the current page, keeping the ends", () => {
    expect(pagerWindow(1, 20)).toEqual([1, 2, 3, null, 20]);
    expect(pagerWindow(10, 20)).toEqual([1, null, 8, 9, 10, 11, 12, null, 20]);
    expect(pagerWindow(20, 20)).toEqual([1, null, 18, 19, 20]);
  });

  it("does not elide a gap of one page", () => {
    expect(pagerWindow(4, 20)).toEqual([1, 2, 3, 4, 5, 6, null, 20]);
  });
});
