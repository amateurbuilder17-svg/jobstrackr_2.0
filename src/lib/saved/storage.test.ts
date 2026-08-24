import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearGuestSaves,
  clearQueue,
  enqueue,
  readGuestSaves,
  readQueue,
  resolvePending,
  writeGuestSaves,
} from "./storage";

/**
 * The Module 7 reconciliation gate.
 *
 * The queue is what makes "instantaneous offline, correct on reconnect" true
 * rather than aspirational, so its rules are tested directly instead of through
 * a rendered component — the interesting cases (repeated toggles, a corrupted
 * store, storage that throws) are painful to provoke through a UI and trivial
 * here.
 */

/** A minimal localStorage, since vitest runs in Node. */
function installStorage(): Map<string, string> {
  const backing = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => backing.get(k) ?? null,
    setItem: (k: string, v: string) => backing.set(k, v),
    removeItem: (k: string) => backing.delete(k),
  });
  return backing;
}

beforeEach(() => {
  installStorage();
});

describe("guest shortlist", () => {
  it("round-trips and de-duplicates", () => {
    writeGuestSaves(["a", "b", "a"]);
    expect(readGuestSaves()).toEqual(["a", "b"]);
  });

  it("clears completely, so a merged shortlist cannot resurrect", () => {
    writeGuestSaves(["a"]);
    clearGuestSaves();
    expect(readGuestSaves()).toEqual([]);
  });
});

describe("pending queue — last intent wins", () => {
  it("collapses save-then-unsave into a single unsave", () => {
    // The case that matters offline: without collapsing, a replay that arrived
    // out of order would leave the job saved — the state the user rejected.
    enqueue("job-1", true, 1);
    enqueue("job-1", false, 2);

    const queue = readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ jobId: "job-1", saved: false });
  });

  it("collapses unsave-then-save into a single save", () => {
    enqueue("job-1", false, 1);
    enqueue("job-1", true, 2);

    expect(readQueue()).toEqual([{ jobId: "job-1", saved: true, at: 2 }]);
  });

  it("keeps intents for different jobs independent", () => {
    enqueue("job-1", true, 1);
    enqueue("job-2", false, 2);
    enqueue("job-1", false, 3);

    expect(readQueue()).toEqual([
      { jobId: "job-2", saved: false, at: 2 },
      { jobId: "job-1", saved: false, at: 3 },
    ]);
  });

  it("drops only the acknowledged job when one is resolved", () => {
    enqueue("job-1", true, 1);
    enqueue("job-2", true, 2);

    resolvePending("job-1");

    expect(readQueue().map((q) => q.jobId)).toEqual(["job-2"]);
  });

  it("resolving something not queued is a no-op, not a throw", () => {
    enqueue("job-1", true, 1);
    expect(() => resolvePending("never-queued")).not.toThrow();
    expect(readQueue()).toHaveLength(1);
  });

  it("empties on clear", () => {
    enqueue("job-1", true, 1);
    clearQueue();
    expect(readQueue()).toEqual([]);
  });
});

describe("hostile and broken storage", () => {
  it("survives malformed JSON", () => {
    localStorage.setItem("jt.saved.queue.v1", "{not json");
    localStorage.setItem("jt.saved.guest.v1", "{not json");

    expect(readQueue()).toEqual([]);
    expect(readGuestSaves()).toEqual([]);
  });

  it("ignores entries of the wrong shape", () => {
    // Hand-edited devtools, or a format from a previous version.
    localStorage.setItem(
      "jt.saved.queue.v1",
      JSON.stringify([{ jobId: "ok", saved: true, at: 1 }, { nope: 1 }, "string"]),
    );
    expect(readQueue()).toEqual([{ jobId: "ok", saved: true, at: 1 }]);
  });

  it("drops non-string ids from the shortlist", () => {
    localStorage.setItem("jt.saved.guest.v1", JSON.stringify(["a", 42, null, "b"]));
    expect(readGuestSaves()).toEqual(["a", "b"]);
  });

  it("does not throw when storage itself refuses to write", () => {
    // Safari private mode, or a full quota. Losing persistence is acceptable;
    // taking the page down with an exception is not.
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("QuotaExceededError");
      },
    });

    expect(() => enqueue("job-1", true)).not.toThrow();
    expect(() => {
      writeGuestSaves(["a"]);
    }).not.toThrow();
    expect(() => {
      clearGuestSaves();
    }).not.toThrow();
  });

  it("is inert when localStorage does not exist at all", () => {
    // Server rendering: these modules are imported by client components that
    // Next also renders on the server.
    vi.stubGlobal("localStorage", undefined);

    expect(readGuestSaves()).toEqual([]);
    expect(readQueue()).toEqual([]);
    expect(() => {
      writeGuestSaves(["a"]);
    }).not.toThrow();
  });
});
