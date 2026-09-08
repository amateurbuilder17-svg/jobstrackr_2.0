import { describe, expect, it, vi } from "vitest";

import { chunkForFilter, selectIn } from "./select-in";

/**
 * The bug this file exists for.
 *
 * PostgREST puts `in` and `or` filters in the query string, so a long list is a
 * long URL, and past roughly 14,500 characters of values the request does not
 * reach the database — it comes back as a bare "Bad Request" or as `fetch
 * failed`, neither of which mentions length. Every one of these reads sits at
 * the top of an ingest path where the error is thrown rather than
 * dead-lettered, so the cost of tripping it is the whole batch.
 */

const key = (i: number) => `k${String(i).padStart(31, "0")}`; // 32 chars, as a dedupe key

describe("chunkForFilter", () => {
  it("keeps a small list in one request", () => {
    expect(chunkForFilter(["a", "b", "c"])).toEqual([["a", "b", "c"]]);
  });

  it("returns nothing for nothing", () => {
    expect(chunkForFilter([])).toEqual([]);
  });

  it("splits on total characters, not on the number of values", () => {
    // The same character budget, spent two ways. A count-based rule would put
    // the same number in each chunk and blow the URL on the wider one — which
    // is exactly how a slug list (80 chars) failed where a dedupe-key list
    // (32 chars) of the same length did not.
    const narrow = chunkForFilter(Array.from({ length: 600 }, (_, i) => key(i)));
    const wide = chunkForFilter(Array.from({ length: 600 }, (_, i) => key(i).repeat(3)));

    expect(narrow.length).toBeLessThan(wide.length);
    for (const chunks of [narrow, wide]) {
      for (const chunk of chunks) {
        expect(chunk.join(",").length).toBeLessThanOrEqual(8_000);
      }
    }
  });

  it("never drops or reorders a value", () => {
    const values = Array.from({ length: 1_000 }, (_, i) => key(i));
    expect(chunkForFilter(values).flat()).toEqual(values);
  });

  it("keeps a single over-budget value rather than losing it", () => {
    // Nothing can be done for a value longer than the whole budget, and
    // silently dropping it would read as "this row does not exist" — which
    // makes ingestion insert a duplicate of a row it already had.
    const huge = "x".repeat(9_000);
    expect(chunkForFilter([huge, "small"])).toEqual([[huge], ["small"]]);
  });

  it("respects a caller's own budget", () => {
    expect(chunkForFilter(["aa", "bb", "cc"], 6)).toEqual([["aa", "bb"], ["cc"]]);
  });
});

describe("selectIn", () => {
  it("concatenates the rows of every chunk", async () => {
    const values = Array.from({ length: 500 }, (_, i) => key(i));
    const read = vi.fn((chunk: string[]) =>
      Promise.resolve({ data: chunk.map((v) => ({ slug: v })), error: null }),
    );

    const { data, error } = await selectIn(values, read);

    expect(error).toBeNull();
    expect(read.mock.calls.length).toBeGreaterThan(1);
    expect(data.map((r) => r.slug)).toEqual(values);
  });

  it("issues exactly one request for a normal batch", async () => {
    // The usual run carries a handful of rows, and must not pay for this.
    const read = vi.fn((chunk: string[]) =>
      Promise.resolve({ data: chunk.map((v) => ({ slug: v })), error: null }),
    );

    await selectIn([key(1), key(2), key(3)], read);

    expect(read).toHaveBeenCalledTimes(1);
  });

  it("makes no request at all for an empty list", async () => {
    const read = vi.fn();
    const { data, error } = await selectIn([], read);

    expect(read).not.toHaveBeenCalled();
    expect(data).toEqual([]);
    expect(error).toBeNull();
  });

  it("stops at the first failing chunk and reports it", async () => {
    // A partial read here is worse than no read: the missing keys look like
    // rows that do not exist, and ingestion inserts duplicates of them.
    const values = Array.from({ length: 1_000 }, (_, i) => key(i));
    let calls = 0;
    const read = (chunk: string[]) => {
      calls += 1;
      return Promise.resolve(
        calls === 2
          ? { data: null, error: { message: "Bad Request" } }
          : { data: chunk.map((v) => ({ slug: v })), error: null },
      );
    };

    const { error } = await selectIn(values, read);

    expect(error).toEqual({ message: "Bad Request" });
    expect(calls).toBe(2);
  });
});
