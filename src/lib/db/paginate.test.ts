import type { PostgrestError } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { API_MAX_ROWS, fetchAllRows } from "./paginate";

/** A fake table of `total` rows, answering PostgREST-style inclusive ranges. */
function table(total: number, cap = API_MAX_ROWS) {
  const calls: [number, number][] = [];
  const page = (from: number, to: number) => {
    calls.push([from, to]);
    // The server-side cap is applied after the request's own range, which is
    // the whole reason this module exists.
    const size = Math.min(to - from + 1, cap);
    const data = Array.from({ length: Math.max(0, Math.min(size, total - from)) }, (_, i) => ({
      slug: `row-${String(from + i)}`,
    }));
    return Promise.resolve({ data, error: null });
  };
  return { page, calls };
}

describe("fetchAllRows", () => {
  it("returns everything when the corpus is smaller than one page", async () => {
    const { page, calls } = table(240);
    await expect(fetchAllRows("t", page)).resolves.toHaveLength(240);
    expect(calls).toHaveLength(1);
  });

  /**
   * The regression under test. Before this helper the query asked for 20,000
   * rows, Supabase returned 1,000, and nothing anywhere reported the other
   * 4,200 as missing.
   */
  it("pages past the 1,000-row cap", async () => {
    const { page, calls } = table(5200);
    const rows = await fetchAllRows("t", page);
    expect(rows).toHaveLength(5200);
    expect(calls).toHaveLength(6); // 5 full pages, then a short one
    expect(rows[5199]?.slug).toBe("row-5199");
  });

  it("stops on an exactly-full final page without an extra round trip", async () => {
    const { page, calls } = table(2000);
    await expect(fetchAllRows("t", page)).resolves.toHaveLength(2000);
    // 2 full pages tell it nothing, so a third confirms the end. The
    // alternative — assuming a full page is the last — would silently truncate
    // at exactly the sizes most likely to occur.
    expect(calls).toHaveLength(3);
  });

  it("honours the ceiling and says so, rather than looping on a growing table", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { page } = table(10_000);

    const rows = await fetchAllRows("t", page, { maxRows: 3000 });

    expect(rows).toHaveLength(3000);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("3000-row ceiling"));
  });

  it("never asks for more than the ceiling on the final page", async () => {
    const { page, calls } = table(10_000);
    await fetchAllRows("t", page, { maxRows: 2500 });
    // 0-999, 1000-1999, 2000-2499 — the last range is clamped, not rounded up.
    expect(calls.at(-1)).toEqual([2000, 2499]);
  });

  it("propagates a database error rather than returning a partial list", async () => {
    const fields = {
      name: "PostgrestError",
      message: "boom",
      details: "",
      hint: "",
      code: "42P01",
    };
    const error: PostgrestError = { ...fields, toJSON: () => fields };
    const page = () => Promise.resolve({ data: null, error });
    await expect(fetchAllRows("t", page)).rejects.toThrow(/boom/);
  });
});
