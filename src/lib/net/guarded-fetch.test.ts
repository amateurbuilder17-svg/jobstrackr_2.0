import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FetchGuardError, guardedFetch, resetCircuits, retryDelayMs } from "./guarded-fetch";

const URL_A = "https://app.test/api/jobs";
const URL_B = "https://app.test/api/session";

function ok(body: unknown = {}): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function status(code: number, headers: Record<string, string> = {}): Response {
  return new Response("{}", { status: code, headers });
}

/** A server that accepts the connection and then never says anything. */
function hangs() {
  return vi.fn((_url: string | URL | Request, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("Aborted", "AbortError"));
      });
    });
  });
}

/** Drives a call to completion with the clock under our control. */
async function settle<T>(promise: Promise<T>): Promise<{ value?: T; error?: unknown }> {
  const settled = promise.then(
    (value) => ({ value }),
    (error: unknown) => ({ error }),
  );
  await vi.runAllTimersAsync();
  return settled;
}

beforeEach(() => {
  resetCircuits();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the happy path stays one request", () => {
  it("sends once and returns the response", async () => {
    const spy = vi.fn(() => Promise.resolve(ok({ items: [] })));
    vi.stubGlobal("fetch", spy);

    const { value } = await settle(guardedFetch(URL_A));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(value?.status).toBe(200);
  });

  it("does not retry a considered refusal", async () => {
    // A 404 is the server working correctly. Asking again cannot change it.
    const spy = vi.fn(() => Promise.resolve(status(404)));
    vi.stubGlobal("fetch", spy);

    const { value } = await settle(guardedFetch(URL_A));

    expect(spy).toHaveBeenCalledTimes(1);
    expect(value?.status).toBe(404);
    expect(retryDelayMs(URL_A)).toBe(0);
  });
});

describe("a call is bounded", () => {
  it("retries a 5xx to the cap and no further", async () => {
    const spy = vi.fn(() => Promise.resolve(status(503)));
    vi.stubGlobal("fetch", spy);

    const { value } = await settle(guardedFetch(URL_A));

    // One attempt plus the two default GET retries. Not four, not forever.
    expect(spy).toHaveBeenCalledTimes(3);
    // The server did answer, so the answer goes back rather than throwing.
    expect(value?.status).toBe(503);
  });

  it("gives up on a server that never replies", async () => {
    vi.stubGlobal("fetch", hangs());

    const { error } = await settle(guardedFetch(URL_A, { retries: 0, timeoutMs: 5_000 }));

    expect(error).toBeInstanceOf(FetchGuardError);
    expect((error as FetchGuardError).reason).toBe("timeout");
  });

  it("does not repeat a write", async () => {
    // A POST that timed out may already have been applied server-side.
    vi.stubGlobal("fetch", hangs());
    const spy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    await settle(guardedFetch(URL_A, { method: "POST", timeoutMs: 1_000 }));

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("the circuit stops the hammering", () => {
  it("refuses to touch the network once an endpoint has failed three times", async () => {
    vi.stubGlobal("fetch", hangs());
    const spy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    for (let i = 0; i < 3; i++) {
      await settle(guardedFetch(URL_A, { retries: 0, timeoutMs: 1_000 }));
    }
    expect(spy).toHaveBeenCalledTimes(3);

    // This is the guardrail: twenty more presses, and not one reaches the wire.
    for (let i = 0; i < 20; i++) {
      const { error } = await settle(guardedFetch(URL_A, { retries: 0, timeoutMs: 1_000 }));
      expect((error as FetchGuardError).reason).toBe("circuit-open");
    }
    expect(spy).toHaveBeenCalledTimes(3);
    expect(retryDelayMs(URL_A)).toBeGreaterThan(0);
  });

  it("keeps endpoints apart", async () => {
    vi.stubGlobal("fetch", hangs());
    const spy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    for (let i = 0; i < 3; i++) {
      await settle(guardedFetch(URL_A, { retries: 0, timeoutMs: 1_000 }));
    }

    // /api/jobs being dead says nothing about /api/session.
    expect(retryDelayMs(URL_B)).toBe(0);
    await settle(guardedFetch(URL_B, { retries: 0, timeoutMs: 1_000 }));
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it("ignores the query string when deciding what is down", async () => {
    vi.stubGlobal("fetch", hangs());

    for (let i = 0; i < 3; i++) {
      await settle(
        guardedFetch(`${URL_A}?after=${String(i)}`, { retries: 0, timeoutMs: 1_000 }),
      );
    }

    // A different page of the same dead endpoint is still the dead endpoint.
    const { error } = await settle(guardedFetch(`${URL_A}?after=9`, { retries: 0 }));
    expect((error as FetchGuardError).reason).toBe("circuit-open");
  });

  it("reopens after the cooldown", async () => {
    vi.stubGlobal("fetch", hangs());
    const spy = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;

    for (let i = 0; i < 3; i++) {
      await settle(guardedFetch(URL_A, { retries: 0, timeoutMs: 1_000 }));
    }

    const wait = retryDelayMs(URL_A);
    expect(wait).toBeGreaterThan(0);

    vi.setSystemTime(Date.now() + wait + 1);
    await settle(guardedFetch(URL_A, { retries: 0, timeoutMs: 1_000 }));

    // One probe is allowed through — being down is not permanent.
    expect(spy).toHaveBeenCalledTimes(4);
  });

  it("forgets the outage as soon as something works", async () => {
    let up = false;
    const spy = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      if (up) return Promise.resolve(ok());
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });
    vi.stubGlobal("fetch", spy);

    await settle(guardedFetch(URL_A, { retries: 0, timeoutMs: 1_000 }));
    await settle(guardedFetch(URL_A, { retries: 0, timeoutMs: 1_000 }));

    up = true;
    await settle(guardedFetch(URL_A, { retries: 0, timeoutMs: 1_000 }));

    // Two failures and a success must not add up to a tripped circuit on the
    // next failure — the count starts again, not one short of the trip.
    up = false;
    await settle(guardedFetch(URL_A, { retries: 0, timeoutMs: 1_000 }));
    expect(retryDelayMs(URL_A)).toBe(0);
  });
});

describe("the server's own instructions win", () => {
  it("waits as long as a Retry-After says", async () => {
    vi.stubGlobal("fetch", () => Promise.resolve(status(429, { "Retry-After": "120" })));

    for (let i = 0; i < 3; i++) {
      await settle(guardedFetch(URL_A, { retries: 0 }));
    }

    // Two minutes, not the fifteen seconds the breaker would have chosen.
    expect(retryDelayMs(URL_A)).toBeGreaterThan(100_000);
  });
});

describe("a caller's own abort is not the server's fault", () => {
  it("does not count against the circuit", async () => {
    vi.stubGlobal("fetch", hangs());

    for (let i = 0; i < 5; i++) {
      const controller = new AbortController();
      const call = guardedFetch(URL_A, { retries: 0, signal: controller.signal });
      const caught = call.catch((error: unknown) => error);
      controller.abort();
      await vi.runAllTimersAsync();
      expect(((await caught) as Error).name).toBe("AbortError");
    }

    // Five abandoned typeahead requests must not lock out the sixth keystroke.
    expect(retryDelayMs(URL_A)).toBe(0);
  });
});
