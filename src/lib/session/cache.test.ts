import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearSessionCache, readSessionCache, writeSessionCache } from "./cache";

/**
 * The rule this file exists to hold: an entry is returned to the account that
 * wrote it, and to nobody else.
 *
 * Everything the cache paints is one person's own data — their name, their
 * shortlist, the exams they track — sitting in a browser profile that may be
 * shared. The interesting cases are therefore all the ways it must *refuse*,
 * and they are trivial here and painful to provoke through a rendered shell.
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

const IDENTITY = {
  name: "Asha",
  email: "asha@example.com",
  initials: "A",
  isAdmin: false,
  hasPassword: true,
};

const ENTRY = {
  uid: "user-1",
  ids: ["job-a", "job-b"],
  trackedJobIds: ["job-c"],
  identity: IDENTITY,
};

let backing: Map<string, string>;

beforeEach(() => {
  backing = installStorage();
});

describe("round trip", () => {
  it("returns what was written, to the account that wrote it", () => {
    writeSessionCache(ENTRY, 1_000);
    expect(readSessionCache("user-1", 2_000)).toEqual({ ...ENTRY, at: 1_000 });
  });

  it("keeps only the newest answer", () => {
    writeSessionCache(ENTRY, 1_000);
    writeSessionCache({ ...ENTRY, ids: ["job-z"] }, 2_000);
    expect(readSessionCache("user-1", 3_000)?.ids).toEqual(["job-z"]);
  });

  it("clears completely, so a signed-out session cannot be painted again", () => {
    writeSessionCache(ENTRY, 1_000);
    clearSessionCache();
    expect(readSessionCache("user-1", 2_000)).toBeNull();
  });
});

describe("refusals", () => {
  it("never hands one account's session to another", () => {
    writeSessionCache(ENTRY, 1_000);
    expect(readSessionCache("user-2", 2_000)).toBeNull();
  });

  it("expires, so an abandoned browser forgets", () => {
    const week = 7 * 24 * 60 * 60 * 1000;
    writeSessionCache(ENTRY, 0);
    expect(readSessionCache("user-1", week)).not.toBeNull();
    expect(readSessionCache("user-1", week + 1)).toBeNull();
  });

  it("refuses an entry written in the future, so a clock change cannot keep it alive", () => {
    writeSessionCache(ENTRY, 10_000);
    expect(readSessionCache("user-1", 5_000)).toBeNull();
  });

  it("misses on an empty store", () => {
    expect(readSessionCache("user-1")).toBeNull();
  });
});

describe("a store holding nonsense", () => {
  it.each([
    ["not JSON at all", "{{{"],
    ["a bare array", "[]"],
    ["no uid", JSON.stringify({ ...ENTRY, uid: undefined, at: 1_000 })],
    ["an empty uid", JSON.stringify({ ...ENTRY, uid: "", at: 1_000 })],
    ["ids that are not strings", JSON.stringify({ ...ENTRY, ids: [1, 2], at: 1_000 })],
    ["no identity", JSON.stringify({ ...ENTRY, identity: null, at: 1_000 })],
    [
      "an identity missing a flag",
      JSON.stringify({ ...ENTRY, identity: { ...IDENTITY, isAdmin: undefined }, at: 1_000 }),
    ],
    ["no timestamp", JSON.stringify(ENTRY)],
  ])("misses rather than painting %s", (_label, raw) => {
    backing.set("jt.session.v1", raw);
    expect(readSessionCache("user-1", 2_000)).toBeNull();
  });
});

describe("storage that refuses to work", () => {
  it("survives a write that throws, and reports no session", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
    });

    expect(() => {
      writeSessionCache(ENTRY);
    }).not.toThrow();
    expect(readSessionCache("user-1")).toBeNull();
  });

  it("survives a read that throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    });

    expect(readSessionCache("user-1")).toBeNull();
  });

  it("is inert with no storage at all, as during a server render", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(readSessionCache("user-1")).toBeNull();
    expect(() => {
      writeSessionCache(ENTRY);
    }).not.toThrow();
    expect(() => {
      clearSessionCache();
    }).not.toThrow();
  });
});
