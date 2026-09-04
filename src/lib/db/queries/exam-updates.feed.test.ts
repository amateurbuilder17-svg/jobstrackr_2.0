import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { decodeCursor } from "../cursor";
import type { UpdateListOptions } from "./exam-updates";

/**
 * The order of the /updates feed.
 *
 * Notifications are served after everything else — see `TAIL_CATEGORY` — which
 * turns one ordered run of rows into two, and a keyset cursor has to know which
 * of them it is walking. These assert the seam between the halves, because that
 * is the only place the arithmetic is interesting and the only place a mistake
 * would silently drop rows out of the feed rather than merely reorder them.
 */

vi.mock("next/cache", () => ({
  cacheLife: () => undefined,
  cacheTag: () => undefined,
}));

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://feed.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_feed",
  NEXT_PUBLIC_SITE_URL: "https://jobstrackr.in",
  SUPABASE_SECRET_KEY: "sb_secret_feed",
  REVALIDATE_SECRET: "r".repeat(64),
  CRON_SECRET: "c".repeat(64),
};

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Rows the fake PostgREST hands back, oldest id last. */
function rows(count: number, from = 0) {
  return Array.from({ length: count }, (_, i) => ({
    id: uuid(from + i + 1),
    slug: `u-${String(from + i + 1)}`,
    category: "result",
    published_at: `2026-0${String((i % 9) + 1)}-01T00:00:00+00:00`,
  }));
}

let requests: URL[] = [];
/** Rows to return, per `category` filter value. */
let byCategory: Record<string, unknown[]> = {};

beforeAll(() => {
  for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
});

beforeEach(() => {
  requests = [];
  byCategory = {};
  vi.stubGlobal("fetch", (input: string | URL | Request) => {
    const href =
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    requests.push(url);

    const category = url.searchParams.get("category") ?? "";
    const limit = Number(url.searchParams.get("limit") ?? "0");
    const body = (byCategory[category] ?? []).slice(0, limit);

    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function listExamUpdates(options: UpdateListOptions = {}) {
  const mod = await import("./exam-updates");
  return mod.listExamUpdates(options);
}

const categories = () => requests.map((u) => u.searchParams.get("category"));

describe("notifications sort behind the rest of the feed", () => {
  it("asks for everything but notifications first", async () => {
    byCategory["neq.notification"] = rows(21);

    const page = await listExamUpdates({ limit: 20 });

    expect(categories()).toEqual(["neq.notification"]);
    expect(page.items).toHaveLength(20);
    // A full head page continues in the head, so no phase is recorded.
    expect(decodeCursor(page.nextCursor)?.phase).toBeUndefined();
  });

  it("does not touch the tail while the head still has pages", async () => {
    byCategory["neq.notification"] = rows(21);

    await listExamUpdates({ limit: 20 });

    expect(categories()).not.toContain("eq.notification");
  });

  it("tops a short head page up from the tail", async () => {
    byCategory["neq.notification"] = rows(3);
    byCategory["eq.notification"] = rows(5, 100);

    const page = await listExamUpdates({ limit: 20 });

    expect(categories()).toEqual(["neq.notification", "eq.notification"]);
    // Head rows first, in the order the head returned them, then the tail.
    expect(page.items.map((row) => row.slug)).toEqual([
      "u-1",
      "u-2",
      "u-3",
      "u-101",
      "u-102",
      "u-103",
      "u-104",
      "u-105",
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it("hands over to the tail when the head ends exactly on a page edge", async () => {
    byCategory["neq.notification"] = rows(20);

    const page = await listExamUpdates({ limit: 20 });

    // No second query: the seam cursor is issued without asking whether the
    // tail has anything in it.
    expect(categories()).toEqual(["neq.notification"]);
    expect(page.items).toHaveLength(20);
    expect(decodeCursor(page.nextCursor)?.phase).toBe(1);
  });

  it("carries the phase forward so a tail page stays in the tail", async () => {
    byCategory["neq.notification"] = rows(20);
    const first = await listExamUpdates({ limit: 20 });

    byCategory["eq.notification"] = rows(21, 200);
    requests = [];
    const second = await listExamUpdates({ limit: 20, cursor: first.nextCursor ?? undefined });

    expect(categories()).toEqual(["eq.notification"]);
    expect(second.items).toHaveLength(20);
    expect(decodeCursor(second.nextCursor)?.phase).toBe(1);
  });

  it("resumes the tail from the last row it showed, not from the top", async () => {
    byCategory["neq.notification"] = rows(3);
    byCategory["eq.notification"] = rows(30, 300);

    const page = await listExamUpdates({ limit: 5 });

    expect(page.items.map((row) => row.slug)).toEqual(["u-1", "u-2", "u-3", "u-301", "u-302"]);
    const cursor = decodeCursor(page.nextCursor);
    expect(cursor?.phase).toBe(1);
    expect(cursor?.id).toBe(uuid(302));
  });

  it("leaves a category-filtered feed as one ordered run", async () => {
    byCategory["eq.notification"] = rows(21);

    const page = await listExamUpdates({ limit: 20, category: "notification" });

    // The reader picked the Notifications chip; nothing is deprioritised, and
    // the cursor is the plain one every other chip produces.
    expect(categories()).toEqual(["eq.notification"]);
    expect(page.items).toHaveLength(20);
    expect(decodeCursor(page.nextCursor)?.phase).toBeUndefined();
  });

  it("still splits when the filter is a search rather than a category", async () => {
    byCategory["neq.notification"] = rows(2);
    byCategory["eq.notification"] = rows(2, 400);

    const page = await listExamUpdates({ limit: 20, query: "admit card" });

    expect(requests.every((u) => u.searchParams.has("search_vector"))).toBe(true);
    expect(page.items.map((row) => row.slug)).toEqual(["u-1", "u-2", "u-401", "u-402"]);
  });
});
