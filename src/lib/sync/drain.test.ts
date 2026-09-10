import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The dead letter only earns its name if something reads it back.
 *
 * These pin the two properties that decide whether a retry is safe to run on
 * every ingest: a row that lands is closed exactly once, and a row that fails
 * again is recorded against the row already there rather than inserted as a
 * second one. The fake deliberately has no `insert`, so a regression into
 * "retry grows the queue it is draining" fails here rather than in production.
 */

interface Result {
  data: unknown[];
  error: { message: string } | null;
}

interface Call {
  op: "read" | "update";
  patch: Record<string, unknown> | null;
  filters: { method: string; args: unknown[] }[];
}

interface Chain {
  select(columns: string): Chain;
  eq(column: string, value: unknown): Chain;
  is(column: string, value: unknown): Chain;
  lt(column: string, value: unknown): Chain;
  order(column: string, options: { ascending: boolean }): Chain;
  limit(count: number): Chain;
  in(column: string, values: unknown[]): Chain;
  update(patch: Record<string, unknown>): Chain;
  then<T>(onfulfilled: (value: Result) => T | PromiseLike<T>): Promise<T>;
}

let openRows: unknown[] = [];
let readError: { message: string } | null = null;
let calls: Call[] = [];

function chain(): Chain {
  const entry: Call = { op: "read", patch: null, filters: [] };
  calls.push(entry);

  const note = (method: string, ...args: unknown[]): Chain => {
    entry.filters.push({ method, args });
    return c;
  };

  const c: Chain = {
    select: (columns) => note("select", columns),
    eq: (column, value) => note("eq", column, value),
    is: (column, value) => note("is", column, value),
    lt: (column, value) => note("lt", column, value),
    order: (column, options) => note("order", column, options),
    limit: (count) => note("limit", count),
    in: (column, values) => note("in", column, values),
    update: (patch) => {
      entry.op = "update";
      entry.patch = patch;
      return c;
    },
    then: (onfulfilled) =>
      Promise.resolve(
        entry.op === "update"
          ? { data: [], error: null }
          : { data: openRows, error: readError },
      ).then(onfulfilled),
  };

  return c;
}

vi.mock("@/lib/db/clients", () => ({ adminDb: () => ({ from: () => chain() }) }));

const { drainDeadLetter } = await import("./drain");

/** An open dead-letter row as the drain reads it back. */
const dead = (id: string, url: string, attempts = 1) => ({
  id,
  attempts,
  payload: { source_url: url, title: `t-${id}` },
});

/** An ingest that refuses whatever `refuse` recognises, by source_url. */
const ingestRefusing = (refuse: (url: unknown) => boolean) => {
  const seen: Record<string, unknown>[][] = [];
  return {
    seen,
    ingest: (rows: Record<string, unknown>[]) => {
      seen.push(rows);
      return Promise.resolve({
        failures: rows
          .filter((r) => refuse(r.source_url))
          .map((r) => ({ error: "refused again", payload: r })),
      });
    },
  };
};

const updates = () => calls.filter((c) => c.op === "update");

beforeEach(() => {
  openRows = [];
  readError = null;
  calls = [];
});

describe("drainDeadLetter", () => {
  it("does nothing when the queue is empty", async () => {
    const { ingest, seen } = ingestRefusing(() => false);
    const out = await drainDeadLetter("jobs", ingest);

    expect(out).toEqual({ attempted: 0, resolved: 0, stillFailing: 0 });
    expect(seen).toEqual([]);
    expect(updates()).toEqual([]);
  });

  it("closes the rows that land this time", async () => {
    openRows = [dead("a", "u/a"), dead("b", "u/b")];
    const { ingest } = ingestRefusing(() => false);

    const out = await drainDeadLetter("jobs", ingest);

    expect(out).toEqual({ attempted: 2, resolved: 2, stillFailing: 0 });

    // One statement for the whole resolved set, and it sets resolved_at.
    const [write, ...rest] = updates();
    expect(rest).toEqual([]);
    expect(write?.patch).toHaveProperty("resolved_at");
    expect(write?.filters.find((f) => f.method === "in")?.args[1]).toEqual(["a", "b"]);
  });

  it("counts a further attempt against the row already there", async () => {
    openRows = [dead("a", "u/a", 2)];
    const { ingest } = ingestRefusing(() => true);

    const out = await drainDeadLetter("jobs", ingest);

    expect(out).toEqual({ attempted: 1, resolved: 0, stillFailing: 1 });

    const [write] = updates();
    // 2 → 3, and the fresh reason replaces the stale one.
    expect(write?.patch).toEqual({ attempts: 3, error: "refused again" });
    // Never an insert: the fake has none, so a retry that grew the queue
    // would have thrown before reaching here.
    expect(write?.filters.find((f) => f.method === "eq")?.args).toEqual(["id", "a"]);
  });

  it("tells two rows apart when they share a source key", async () => {
    // The reason success is decided by object identity rather than by matching
    // `source_key`: these two are indistinguishable by key.
    openRows = [dead("a", "same/url"), dead("b", "same/url")];
    let call = 0;
    const ingest = (rows: Record<string, unknown>[]) => {
      call += 1;
      // Only the second row is refused.
      const second = rows[1];
      return Promise.resolve({
        failures: second ? [{ error: "refused again", payload: second }] : [],
      });
    };

    const out = await drainDeadLetter("jobs", ingest);

    expect(call).toBe(1);
    expect(out).toEqual({ attempted: 2, resolved: 1, stillFailing: 1 });

    const resolveWrite = updates().find((c) => c.patch !== null && "resolved_at" in c.patch);
    expect(resolveWrite?.filters.find((f) => f.method === "in")?.args[1]).toEqual(["a"]);

    const retryWrite = updates().find((c) => c.patch !== null && "attempts" in c.patch);
    expect(retryWrite?.filters.find((f) => f.method === "eq")?.args).toEqual(["id", "b"]);
  });

  it("stops offering a row once it has used up its attempts", async () => {
    openRows = [dead("a", "u/a")];
    const { ingest } = ingestRefusing(() => false);

    await drainDeadLetter("jobs", ingest, { maxAttempts: 5, limit: 25 });

    const read = calls[0];
    expect(read?.filters).toContainEqual({ method: "lt", args: ["attempts", 5] });
    expect(read?.filters).toContainEqual({ method: "is", args: ["resolved_at", null] });
    expect(read?.filters).toContainEqual({ method: "eq", args: ["kind", "jobs"] });
    expect(read?.filters).toContainEqual({ method: "limit", args: [25] });
    // Oldest first: a row that has waited longest is retried first.
    expect(read?.filters).toContainEqual({
      method: "order",
      args: ["created_at", { ascending: true }],
    });
  });

  it("gives up quietly when the queue cannot be read", async () => {
    readError = { message: "connection reset" };
    const { ingest, seen } = ingestRefusing(() => false);

    // Opportunistic repair must never fail the run it is riding on.
    const out = await drainDeadLetter("jobs", ingest);

    expect(out).toEqual({ attempted: 0, resolved: 0, stillFailing: 0 });
    expect(seen).toEqual([]);
  });

  it("skips a row whose stored payload is not an object", async () => {
    openRows = [{ id: "a", attempts: 1, payload: "not-a-row" }, dead("b", "u/b")];
    const { ingest, seen } = ingestRefusing(() => false);

    const out = await drainDeadLetter("jobs", ingest);

    expect(out.attempted).toBe(1);
    expect(seen[0]).toEqual([{ source_url: "u/b", title: "t-b" }]);
  });

  it("asks for nothing when its budget is zero", async () => {
    openRows = [dead("a", "u/a")];
    const { ingest, seen } = ingestRefusing(() => false);

    const out = await drainDeadLetter("jobs", ingest, { limit: 0 });

    expect(out).toEqual({ attempted: 0, resolved: 0, stillFailing: 0 });
    expect(seen).toEqual([]);
    expect(calls).toEqual([]);
  });
});
