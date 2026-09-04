import { describe, expect, it } from "vitest";

import { highestUpdatedAt, mergeByUpdatedAt, trimToCompleteBatch } from "./candidates";
import type { SeoUrl } from "./targets";

const at = (updatedAt: string, url = `https://x.test/jobs/${updatedAt}`): SeoUrl => ({
  url,
  entity: "job",
  updatedAt,
});

/**
 * The whole file is about one hazard: the watermark is a timestamp, the next
 * run asks for rows strictly after it, and `updated_at` defaults to `now()` —
 * which in Postgres is the transaction clock, so a bulk ingest stamps every row
 * it writes identically. A batch that stops inside one of those groups and then
 * advances past it loses the rest of the group permanently.
 */
describe("trimToCompleteBatch", () => {
  it("keeps everything when the set is exhausted", () => {
    const rows = [at("2026-09-01T00:00:00Z"), at("2026-09-02T00:00:00Z")];
    expect(trimToCompleteBatch(rows, 5)).toHaveLength(2);
  });

  it("keeps the full batch when the next row starts a new timestamp", () => {
    const rows = [
      at("2026-09-01T00:00:00Z"),
      at("2026-09-02T00:00:00Z"),
      at("2026-09-03T00:00:00Z"),
    ];
    // limit 2, so row three is only there to be inspected.
    expect(trimToCompleteBatch(rows, 2).map((r) => r.updatedAt)).toEqual([
      "2026-09-01T00:00:00Z",
      "2026-09-02T00:00:00Z",
    ]);
  });

  it("drops the trailing rows that share a timestamp with the first excluded row", () => {
    const shared = "2026-09-02T00:00:00Z";
    const rows = [at("2026-09-01T00:00:00Z"), at(shared, "a"), at(shared, "b")];

    // Taking both `shared` rows would be fine; taking only the first and then
    // moving the watermark to `shared` would lose the second forever.
    expect(trimToCompleteBatch(rows, 2).map((r) => r.updatedAt)).toEqual([
      "2026-09-01T00:00:00Z",
    ]);
  });

  it("takes the batch whole rather than stalling when one timestamp fills it", () => {
    const shared = "2026-09-02T00:00:00Z";
    const rows = [at(shared, "a"), at(shared, "b"), at(shared, "c")];

    // Trimming would leave nothing, and returning nothing on every run forever
    // is a livelock that presents as "push indexing silently stopped".
    expect(trimToCompleteBatch(rows, 2)).toHaveLength(2);
  });
});

describe("highestUpdatedAt", () => {
  it("is null for an empty batch, so the caller leaves the watermark alone", () => {
    expect(highestUpdatedAt([])).toBeNull();
  });

  it("is the maximum, not the last element", () => {
    expect(highestUpdatedAt([at("2026-09-03T00:00:00Z"), at("2026-09-01T00:00:00Z")])).toBe(
      "2026-09-03T00:00:00Z",
    );
  });
});

describe("mergeByUpdatedAt", () => {
  it("interleaves the two tables chronologically", () => {
    const jobs = [at("2026-09-01T00:00:00Z", "job-1"), at("2026-09-03T00:00:00Z", "job-2")];
    const updates = [
      { url: "upd-1", entity: "update" as const, updatedAt: "2026-09-02T00:00:00Z" },
    ];

    // Jobs-then-updates would put upd-1 after job-2, so a batch cut at two
    // would advance the watermark past an update that was never submitted.
    expect(mergeByUpdatedAt(jobs, updates).map((r) => r.url)).toEqual([
      "job-1",
      "upd-1",
      "job-2",
    ]);
  });
});
