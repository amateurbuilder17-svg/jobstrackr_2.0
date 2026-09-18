import { describe, expect, it } from "vitest";

import { pickRailRows, takenSlugs } from "./rails";

const row = (slug: string) => ({ id: `id-${slug}`, slug });

describe("takenSlugs", () => {
  it("always holds the page's own slug", () => {
    // The exclusion that matters: `listLatestInCategory` is keyed on the
    // category so every page shares one cache entry, which means the current
    // update is inside its own rail and nothing upstream can drop it.
    expect(takenSlugs("ssc-cgl-result-2026").has("ssc-cgl-result-2026")).toBe(true);
  });

  it("folds in rails that were composed before it", () => {
    const siblings = [row("ssc-chsl-result"), row("ssc-mts-admit-card")];
    const taken = takenSlugs("ssc-cgl-result", siblings);

    expect([...taken].sort()).toEqual([
      "ssc-cgl-result",
      "ssc-chsl-result",
      "ssc-mts-admit-card",
    ]);
  });

  it("accepts several rails", () => {
    const taken = takenSlugs("a", [row("b")], [row("c"), row("d")]);
    expect(taken.size).toBe(4);
  });
});

describe("pickRailRows", () => {
  it("drops rows the page already links to", () => {
    const taken = takenSlugs("ssc-cgl-result", [row("ssc-chsl-result")]);
    const latest = [row("ssc-cgl-result"), row("ssc-chsl-result"), row("rrb-ntpc-result")];

    expect(pickRailRows(latest, taken, 5).map((r) => r.slug)).toEqual(["rrb-ntpc-result"]);
  });

  it("stops at the limit", () => {
    const latest = ["a", "b", "c", "d", "e"].map(row);
    expect(pickRailRows(latest, takenSlugs("self"), 3).map((r) => r.slug)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("claims what it picks, so the next rail cannot repeat it", () => {
    // The whole point of passing one mutable set down the page: the results
    // rail and the admit-card rail are separate queries that can, and on a
    // quiet ingest day do, surface the same row.
    const taken = takenSlugs("self");
    const first = pickRailRows([row("shared"), row("only-first")], taken, 2);
    const second = pickRailRows([row("shared"), row("only-second")], taken, 2);

    expect(first.map((r) => r.slug)).toEqual(["shared", "only-first"]);
    expect(second.map((r) => r.slug)).toEqual(["only-second"]);
  });

  it("returns nothing for a non-positive limit rather than everything", () => {
    // `limit` is arithmetic at the call site — the rail's cap minus what an
    // earlier rail took — so zero and negative are reachable values, and
    // `Array.prototype.slice` semantics here would render a full rail.
    expect(pickRailRows([row("a")], takenSlugs("self"), 0)).toEqual([]);
    expect(pickRailRows([row("a")], takenSlugs("self"), -2)).toEqual([]);
  });

  it("survives a rail whose rows are all already taken", () => {
    const taken = takenSlugs("self", [row("a"), row("b")]);
    expect(pickRailRows([row("a"), row("b")], taken, 4)).toEqual([]);
  });
});
