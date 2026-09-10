import { describe, expect, it } from "vitest";

import { BUDGET_EXHAUSTED, insertIsolatingFailures } from "./insert-batch";

/**
 * The property under test is the one three production outages were caused by
 * not having: a row the database refuses must cost that row and nothing else.
 */

/** A table that rejects any chunk containing a row `isBad` recognises. */
function rejecting(isBad: (row: string) => boolean) {
  const written: string[] = [];
  return {
    written,
    insert: (chunk: string[]) => {
      const bad = chunk.find(isBad);
      if (bad !== undefined) return Promise.resolve({ error: { message: `refused ${bad}` } });
      written.push(...chunk);
      return Promise.resolve({ error: null as { message: string } | null });
    },
  };
}

/** A table with a UNIQUE constraint, violated within a chunk or against prior rows. */
function uniqueTable() {
  const written: string[] = [];
  return {
    written,
    insert: (chunk: string[]) => {
      const seen = new Set(written);
      for (const row of chunk) {
        if (seen.has(row)) {
          return Promise.resolve({ error: { message: `duplicate key ${row}` } });
        }
        seen.add(row);
      }
      written.push(...chunk);
      return Promise.resolve({ error: null as { message: string } | null });
    },
  };
}

const rows = (n: number, prefix = "r") =>
  Array.from({ length: n }, (_, i) => `${prefix}${String(i)}`);

describe("insertIsolatingFailures", () => {
  it("writes nothing and asks nothing of an empty batch", async () => {
    const table = rejecting(() => true);
    const outcome = await insertIsolatingFailures([], table.insert);

    expect(outcome).toEqual({ inserted: 0, failures: [], attempts: 0 });
  });

  it("costs exactly one statement when every row is good", async () => {
    const table = rejecting(() => false);
    const outcome = await insertIsolatingFailures(rows(200), table.insert);

    // The reason this is not a per-row loop. A healthy run must not pay for
    // the machinery that exists for the unhealthy one.
    expect(outcome.attempts).toBe(1);
    expect(outcome.inserted).toBe(200);
    expect(outcome.failures).toEqual([]);
  });

  it("loses one row rather than the batch", async () => {
    const table = rejecting((row) => row === "r97");
    const outcome = await insertIsolatingFailures(rows(150), table.insert);

    expect(outcome.inserted).toBe(149);
    expect(outcome.failures).toEqual([{ row: "r97", error: "refused r97" }]);
    expect(table.written).toHaveLength(149);
    expect(table.written).not.toContain("r97");
  });

  it("isolates one bad row out of 150 in well under twenty statements", async () => {
    const table = rejecting((row) => row === "r0");
    const outcome = await insertIsolatingFailures(rows(150), table.insert);

    // Bisection is O(log n) to find one offender. If this regresses to a
    // linear scan the cost shows up here before it shows up in a timeout.
    expect(outcome.attempts).toBeLessThanOrEqual(20);
    expect(outcome.inserted).toBe(149);
  });

  it("finds several offenders scattered through the batch", async () => {
    const bad = new Set(["r3", "r64", "r65", "r120"]);
    const table = rejecting((row) => bad.has(row));
    const outcome = await insertIsolatingFailures(rows(150), table.insert);

    expect(outcome.inserted).toBe(146);
    expect(outcome.failures.map((f) => f.row).sort()).toEqual(["r120", "r3", "r64", "r65"]);
  });

  it("survives a batch in which nothing is acceptable", async () => {
    const table = rejecting(() => true);
    const outcome = await insertIsolatingFailures(rows(32), table.insert);

    expect(outcome.inserted).toBe(0);
    expect(outcome.failures).toHaveLength(32);
    expect(table.written).toEqual([]);
  });

  it("keeps the earlier of two rows that collide with each other", async () => {
    // The exam_updates_slug_key case: two rows in one batch wanting one slug.
    // Which one survives must not depend on request timing, so chunks are
    // attempted in order and the later row is the one isolated.
    const table = uniqueTable();
    const outcome = await insertIsolatingFailures(["a", "b", "a", "c"], table.insert);

    expect(table.written).toEqual(["a", "b", "c"]);
    expect(outcome.inserted).toBe(3);
    expect(outcome.failures).toEqual([{ row: "a", error: "duplicate key a" }]);
  });

  it("reports rows it never got to rather than dropping them", async () => {
    const table = rejecting(() => true);
    const outcome = await insertIsolatingFailures(rows(64), table.insert, { maxAttempts: 10 });

    expect(outcome.attempts).toBeLessThanOrEqual(10);
    // Every row is accounted for, whether it was tried or not.
    expect(outcome.failures).toHaveLength(64);
    expect(outcome.failures.some((f) => f.error === BUDGET_EXHAUSTED)).toBe(true);
  });

  it("walks small chunks instead of splitting them", async () => {
    const table = rejecting((row) => row === "r2");
    const outcome = await insertIsolatingFailures(rows(4), table.insert, { linearBelow: 8 });

    // One failed attempt at the chunk, then one per row.
    expect(outcome.attempts).toBe(5);
    expect(outcome.inserted).toBe(3);
  });
});
