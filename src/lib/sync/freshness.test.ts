import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A monitor is only worth having if it is wrong in the safe direction. These
 * pin the two ways this one could be wrong in the dangerous one: reporting
 * health from a stream of failures, and reporting health when it cannot see.
 */

interface Result {
  data: unknown;
  error: { message: string } | null;
}

interface Chain {
  select(columns: string): Chain;
  in(column: string, values: unknown[]): Chain;
  order(column: string, options: { ascending: boolean }): Chain;
  limit(count: number): Chain;
  then<T>(onfulfilled: (value: Result) => T | PromiseLike<T>): Promise<T>;
}

let result: Result = { data: [], error: null };

function chain(): Chain {
  const c: Chain = {
    select: () => c,
    in: () => c,
    order: () => c,
    limit: () => c,
    then: (onfulfilled) => Promise.resolve(result).then(onfulfilled),
  };
  return c;
}

vi.mock("@/lib/db/clients", () => ({ adminDb: () => ({ from: chain }) }));

const { ingestFreshness, DEFAULT_THRESHOLD_MINUTES } = await import("./freshness");

const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const run = (status: string, m: number) => ({ status, started_at: minsAgo(m) });

beforeEach(() => {
  result = { data: [], error: null };
});

describe("ingestFreshness", () => {
  it("is healthy while ingestion is landing", async () => {
    result = { data: [run("succeeded", 12)], error: null };

    const f = await ingestFreshness();

    expect(f.status).toBe("ok");
    expect(f.ageMinutes).toBe(12);
    expect(f.consecutiveFailures).toBe(0);
  });

  it("counts a partial run as a success, because it ingested", async () => {
    // `partial` means some rows were dead-lettered, not that nothing landed.
    result = { data: [run("partial", 20)], error: null };

    expect((await ingestFreshness()).status).toBe("ok");
  });

  it("goes stale once nothing has landed for longer than the threshold", async () => {
    result = { data: [run("succeeded", DEFAULT_THRESHOLD_MINUTES + 1)], error: null };

    const f = await ingestFreshness();

    expect(f.status).toBe("stale");
    expect(f.detail).toContain("over the");
  });

  it("does not mistake a stream of failures for health", async () => {
    // The dangerous case, and the one a naive "is there a recent row?" check
    // gets wrong: a broken feed produces constant activity and zero ingestion.
    result = {
      data: [run("failed", 5), run("failed", 35), run("failed", 65), run("succeeded", 400)],
      error: null,
    };

    const f = await ingestFreshness();

    expect(f.status).toBe("stale");
    expect(f.consecutiveFailures).toBe(3);
    expect(f.ageMinutes).toBe(400);
  });

  it("reports failures alongside health when a recent run did land", async () => {
    // Worth surfacing without crying wolf: the feed is flaky but data is moving.
    result = { data: [run("failed", 5), run("succeeded", 30)], error: null };

    const f = await ingestFreshness();

    expect(f.status).toBe("ok");
    expect(f.consecutiveFailures).toBe(1);
  });

  it("is stale, not healthy, when nothing has ever run", async () => {
    result = { data: [], error: null };

    const f = await ingestFreshness();

    expect(f.status).toBe("stale");
    expect(f.detail).toContain("ever been recorded");
  });

  it("says unknown rather than ok when it cannot see", async () => {
    // A check that reports healthy while blind is worse than no check, because
    // it is believed. The route turns this into a 503 too.
    result = { data: null, error: { message: "connection reset" } };

    const f = await ingestFreshness();

    expect(f.status).toBe("unknown");
    expect(f.status).not.toBe("ok");
    expect(f.detail).toContain("connection reset");
  });

  it("honours a caller that wants a tighter alarm", async () => {
    result = { data: [run("succeeded", 45)], error: null };

    expect((await ingestFreshness(180)).status).toBe("ok");
    expect((await ingestFreshness(30)).status).toBe("stale");
  });
});
