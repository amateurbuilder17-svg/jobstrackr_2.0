import { describe, expect, it } from "vitest";

import { clampLimit, decodeCursor, encodeCursor, MAX_PAGE_SIZE, toPage } from "./cursor";

const ID = "b68f905a-5c9f-402f-9e75-1f9563ecc853";
const TS = "2026-03-10T16:42:32.260107+00:00";

describe("cursor round trip", () => {
  it("survives encode then decode", () => {
    const encoded = encodeCursor({ sortKey: TS, id: ID });
    expect(decodeCursor(encoded)).toEqual({ sortKey: TS, id: ID });
  });

  it("is URL-safe", () => {
    const encoded = encodeCursor({ sortKey: TS, id: ID });
    expect(encoded).not.toMatch(/[+/=]/);
    expect(encodeURIComponent(encoded)).toBe(encoded);
  });
});

describe("a bad cursor starts from the beginning rather than erroring", () => {
  // Cursors live in URLs, so they get shared, bookmarked and truncated by chat
  // clients. A stale one is an ordinary event; failing the page over it turns a
  // shrug into a 500. RLS still applies to every row, so strictness buys nothing.
  it.each([
    ["undefined", undefined],
    ["null", null],
    ["empty", ""],
    ["not base64", "!!!!"],
    ["base64 of nonsense", Buffer.from("hello").toString("base64url")],
    ["valid JSON, wrong shape", Buffer.from('{"a":1}').toString("base64url")],
    ["id is not a uuid", Buffer.from('{"k":"x","i":"nope"}').toString("base64url")],
    ["missing sort key", Buffer.from(`{"i":"${ID}"}`).toString("base64url")],
    ["truncated", encodeCursor({ sortKey: TS, id: ID }).slice(0, 8)],
  ])("%s returns null", (_label, input) => {
    expect(decodeCursor(input)).toBeNull();
  });
});

describe("toPage", () => {
  const rows = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `0000000${String(i)}-0000-4000-8000-000000000000`.slice(-36),
      published_at: `2026-03-${String(i + 1).padStart(2, "0")}T00:00:00+00:00`,
    }));

  const key = (r: { id: string; published_at: string | null }) => ({
    sortKey: r.published_at,
    id: r.id,
  });

  it("drops the probe row and emits a cursor when a next page exists", () => {
    const page = toPage(rows(21), 20, key);
    expect(page.items).toHaveLength(20);
    expect(page.nextCursor).not.toBeNull();
  });

  it("emits no cursor on the last page", () => {
    const page = toPage(rows(20), 20, key);
    expect(page.items).toHaveLength(20);
    expect(page.nextCursor).toBeNull();
  });

  it("handles a short page", () => {
    const page = toPage(rows(3), 20, key);
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });

  it("handles no results", () => {
    const page = toPage([], 20, key);
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it("resumes from the last item actually returned, not the probe row", () => {
    const all = rows(21);
    const page = toPage(all, 20, key);
    const cursor = decodeCursor(page.nextCursor);
    expect(cursor?.id).toBe(all[19]?.id);
  });

  it("ignores a null sort key on the probe row, which is discarded anyway", () => {
    const withNull = [...rows(20), { id: ID, published_at: null }];
    const page = toPage(withNull, 20, key);
    // The 21st row only signals "there is more"; it is dropped, and the cursor
    // comes from row 20, which has a perfectly good sort key.
    expect(page.items).toHaveLength(20);
    expect(page.nextCursor).not.toBeNull();
  });

  it("ends the page rather than emitting an unusable cursor", () => {
    // Here the *last retained* row has no sort key, so there is nothing to
    // resume from. Emitting a cursor would silently restart from the top —
    // an infinite scroll that loops forever without ever erroring.
    const lastRowNull = [
      ...rows(19),
      { id: ID, published_at: null },
      { id: "c0000000-0000-4000-8000-000000000000", published_at: "2026-04-01T00:00:00+00:00" },
    ];
    const page = toPage(lastRowNull, 20, key);
    expect(page.items).toHaveLength(20);
    expect(page.nextCursor).toBeNull();
  });
});

describe("clampLimit", () => {
  it("falls back when unset", () => {
    expect(clampLimit(undefined, 20)).toBe(20);
  });

  it.each([
    [0, 1],
    [-5, 1],
    [7, 7],
    [MAX_PAGE_SIZE + 1, MAX_PAGE_SIZE],
    [10_000, MAX_PAGE_SIZE],
  ])("clamps %s to %s", (input, expected) => {
    expect(clampLimit(input, 20)).toBe(expected);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("rejects %s", (input) => {
    expect(clampLimit(input, 20)).toBe(20);
  });

  it("truncates a fractional page size", () => {
    expect(clampLimit(12.9, 20)).toBe(12);
  });
});
