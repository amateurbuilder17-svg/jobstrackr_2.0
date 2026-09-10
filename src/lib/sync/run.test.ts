import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The bookmark is the whole self-healing property, and it fails silently when
 * it is wrong: advancing it past a window nobody processed does not error, it
 * just skips those rows forever. That is the failure these pin down.
 */

interface Result {
  data: unknown;
  error: { message: string } | null;
}

interface Call {
  table: string;
  methods: { name: string; args: unknown[] }[];
}

interface Chain {
  select(columns: string): Chain;
  eq(column: string, value: unknown): Chain;
  in(column: string, values: unknown[]): Chain;
  is(column: string, value: unknown): Chain;
  lt(column: string, value: unknown): Chain;
  gte(column: string, value: unknown): Chain;
  order(column: string, options: { ascending: boolean }): Chain;
  limit(count: number): Chain;
  update(patch: Record<string, unknown>): Chain;
  insert(values: Record<string, unknown>): Chain;
  single(): Chain;
  then<T>(onfulfilled: (value: Result) => T | PromiseLike<T>): Promise<T>;
}

/** Results are consumed in call order, which also asserts the order of queries. */
let queued: Result[] = [];
let calls: Call[] = [];

function chain(table: string): Chain {
  const entry: Call = { table, methods: [] };
  calls.push(entry);

  const note = (name: string, ...args: unknown[]): Chain => {
    entry.methods.push({ name, args });
    return c;
  };

  const c: Chain = {
    select: (columns) => note("select", columns),
    eq: (column, value) => note("eq", column, value),
    in: (column, values) => note("in", column, values),
    is: (column, value) => note("is", column, value),
    lt: (column, value) => note("lt", column, value),
    gte: (column, value) => note("gte", column, value),
    order: (column, options) => note("order", column, options),
    limit: (count) => note("limit", count),
    update: (patch) => note("update", patch),
    insert: (values) => note("insert", values),
    single: () => note("single"),
    then: (onfulfilled) =>
      Promise.resolve(queued.shift() ?? { data: [], error: null }).then(onfulfilled),
  };

  return c;
}

vi.mock("@/lib/db/clients", () => ({ adminDb: () => ({ from: chain }) }));

const { bookmarkFor, claimIngestSlot, INCOMPLETE } = await import("./run");

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const agoMs = (at: string) => Date.now() - new Date(at).getTime();

beforeEach(() => {
  queued = [];
  calls = [];
});

describe("bookmarkFor", () => {
  it("reaches back seven days when there is no history at all", async () => {
    queued = [{ data: [], error: null }];

    const since = await bookmarkFor("jobs");

    expect(agoMs(since)).toBeGreaterThanOrEqual(7 * DAY - MINUTE);
    expect(agoMs(since)).toBeLessThanOrEqual(7 * DAY + MINUTE);
  });

  it("resumes half an hour before the last complete run", async () => {
    // The overlap is not slack: a row written while the last run was mid-flight
    // is older than that run's started_at and would otherwise never be seen.
    queued = [{ data: [{ started_at: iso(60 * MINUTE), error: null }], error: null }];

    const since = await bookmarkFor("jobs");

    expect(agoMs(since)).toBeGreaterThan(89 * MINUTE);
    expect(agoMs(since)).toBeLessThan(91 * MINUTE);
  });

  it("refuses to advance past a run that never consumed its window", async () => {
    // The dangerous case. The 20-minute run stopped early, so resuming from it
    // would skip everything it did not reach; the bookmark has to fall back to
    // the last run that actually finished.
    queued = [
      {
        data: [
          { started_at: iso(20 * MINUTE), error: INCOMPLETE },
          { started_at: iso(50 * MINUTE), error: INCOMPLETE },
          { started_at: iso(200 * MINUTE), error: null },
        ],
        error: null,
      },
    ];

    const since = await bookmarkFor("jobs");

    expect(agoMs(since)).toBeGreaterThan(229 * MINUTE);
    expect(agoMs(since)).toBeLessThan(231 * MINUTE);
  });

  it("falls back to the floor when every run it can see was incomplete", async () => {
    queued = [{ data: [{ started_at: iso(30 * MINUTE), error: INCOMPLETE }], error: null }];

    const since = await bookmarkFor("jobs");

    expect(agoMs(since)).toBeGreaterThanOrEqual(7 * DAY - MINUTE);
  });

  it("never reaches back further than seven days", async () => {
    // A month-long outage must not ask upstream for the entire 85 MB sheet.
    queued = [{ data: [{ started_at: iso(30 * DAY), error: null }], error: null }];

    const since = await bookmarkFor("jobs");

    expect(agoMs(since)).toBeLessThanOrEqual(7 * DAY + MINUTE);
  });

  it("keeps each kind on its own bookmark", async () => {
    queued = [{ data: [], error: null }];

    await bookmarkFor("exam_updates");

    const [read] = calls;
    expect(read?.methods).toContainEqual({ name: "eq", args: ["kind", "exam_updates"] });
    // A run that failed outright ingested nothing and is not a resume point.
    expect(read?.methods).toContainEqual({
      name: "in",
      args: ["status", ["succeeded", "partial"]],
    });
  });

  it("reaches back to the floor rather than guessing when the table is unreadable", async () => {
    queued = [{ data: null, error: { message: "connection reset" } }];

    const since = await bookmarkFor("jobs");

    // Re-reading a window is cheap; skipping one is permanent.
    expect(agoMs(since)).toBeGreaterThanOrEqual(7 * DAY - MINUTE);
  });
});

describe("claimIngestSlot", () => {
  it("stands aside for a run that is genuinely in flight", async () => {
    const busyAt = iso(30_000);
    queued = [
      { data: [], error: null }, // reap found nothing
      { data: [{ started_at: busyAt }], error: null },
    ];

    const claim = await claimIngestSlot();

    expect(claim.ok).toBe(false);
    expect(claim.busySince).toBe(busyAt);
  });

  it("takes the slot when nothing is running", async () => {
    queued = [
      { data: [], error: null },
      { data: [], error: null },
    ];

    expect(await claimIngestSlot()).toEqual({ ok: true, reaped: 0 });
  });

  it("clears a row a dead worker left behind and proceeds", async () => {
    // Without this the abandoned row blocks every later run and shows in the
    // admin console as an in-flight job that will never finish.
    queued = [
      { data: [{ id: "stale-1" }, { id: "stale-2" }], error: null },
      { data: [], error: null },
    ];

    const claim = await claimIngestSlot();

    expect(claim).toEqual({ ok: true, reaped: 2 });

    const [reap] = calls;
    expect(reap?.methods.find((m) => m.name === "eq")?.args).toEqual(["status", "running"]);
    const patch = reap?.methods.find((m) => m.name === "update")?.args[0];
    expect(patch).toHaveProperty("status", "failed");
  });

  it("ingests anyway when it cannot tell whether anything is running", async () => {
    queued = [
      { data: [], error: null },
      { data: null, error: { message: "connection reset" } },
    ];

    // A duplicated run costs a wasted fetch; a refused run costs the window.
    expect((await claimIngestSlot()).ok).toBe(true);
  });
});
