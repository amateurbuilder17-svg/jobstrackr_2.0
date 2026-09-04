import { readFileSync } from "node:fs";
import { join } from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

/**
 * What the service worker is allowed to keep.
 *
 * `public/sw.js` is not imported by anything, so nothing else in this suite can
 * catch a mistake in it — and the mistakes it can make are the expensive kind.
 * A worker persists in a browser after the deploy that shipped it, so a bad one
 * cannot be rolled back by redeploying; and its cache is shared by everyone
 * using the browser profile, so a page cached in error is one person's data
 * shown to the next person on a shared phone.
 *
 * That second hazard is the reason for most of what follows. Two routes here
 * look public and are not — `/` calls `getUser()` and renders a tracked-exams
 * section, and `/calendar` renders the signed-in user's saved exams — and both
 * were on the allowlist in the first draft of the worker. These tests are what
 * stop them coming back.
 *
 * The worker is a classic script rather than a module, so it is evaluated here
 * against a hand-built `ServiceWorkerGlobalScope` and driven through its own
 * event handlers. That is more machinery than a unit test usually deserves,
 * but it is the only way to assert on behaviour rather than on the source text.
 */

const swSource = readFileSync(join(import.meta.dirname, "..", "..", "public", "sw.js"), "utf8");

/**
 * A stand-in for `Request`, because the real one cannot express what is being
 * tested. Node's constructor rejects `mode: "navigate"` outright — the spec
 * reserves navigation requests for browsers — and `mode` is precisely how the
 * worker tells a page load from a subresource. So the worker is handed this
 * shape instead; it only ever reads `method`, `url`, `mode` and `headers`.
 */
class FakeRequest {
  readonly method: string;
  readonly url: string;
  readonly mode: string;
  readonly headers: Headers;

  constructor(url: string, init: { method?: string; mode?: string } = {}) {
    // Absolute, like the real constructor: it resolves against the worker's
    // scope. Storing the raw string instead makes a precache written as
    // `/offline` unreachable by a lookup for the same page, which is a bug in
    // the harness that looks exactly like a bug in the fallback.
    this.url = new URL(url, "https://jobstrackr.in").href;
    this.method = init.method ?? "GET";
    this.mode = init.mode ?? "cors";
    this.headers = new Headers();
  }
}

/**
 * A same-origin response, as a browser would report it.
 *
 * `fetch` in Node reports `type: "default"`; a browser reports `"basic"` for
 * same-origin replies, and the worker checks for exactly that before caching —
 * an opaque cross-origin response cannot be inspected, so it cannot be judged
 * safe to keep. Without this the worker would correctly refuse to cache
 * anything here and every cache assertion would pass for the wrong reason.
 */
function basic(body: string, init?: ResponseInit): Response {
  const response = new Response(body, init);
  Object.defineProperty(response, "type", { value: "basic" });
  return response;
}

interface FakeCache {
  store: Map<string, Response>;
  match(request: FakeRequest | string): Promise<Response | undefined>;
  put(request: FakeRequest | string, response: Response): Promise<void>;
  add(request: FakeRequest): Promise<void>;
  keys(): Promise<FakeRequest[]>;
}

type Handlers = Record<string, (event: FakeEvent) => void>;

interface FakeEvent {
  request?: FakeRequest;
  respondWith(response: Promise<Response> | Response): void;
  waitUntil(promise: Promise<unknown>): void;
}

const keyOf = (request: FakeRequest | string) =>
  typeof request === "string" ? new URL(request, "https://jobstrackr.in").href : request.url;

function makeCaches() {
  const caches = new Map<string, FakeCache>();

  const open = (name: string): Promise<FakeCache> => {
    let cache = caches.get(name);
    if (!cache) {
      const store = new Map<string, Response>();
      cache = {
        store,
        match: (request) => Promise.resolve(store.get(keyOf(request))),
        put: (request, response) => {
          store.set(keyOf(request), response);
          return Promise.resolve();
        },
        add: (request) => {
          store.set(keyOf(request), basic("precached"));
          return Promise.resolve();
        },
        keys: () => Promise.resolve([...store.keys()].map((url) => new FakeRequest(url))),
      };
      caches.set(name, cache);
    }
    return Promise.resolve(cache);
  };

  return {
    api: {
      open,
      keys: () => Promise.resolve([...caches.keys()]),
      delete: (name: string) => Promise.resolve(caches.delete(name)),
    },
    raw: caches,
  };
}

/**
 * Evaluates `sw.js` and returns its captured handlers plus the fake environment.
 *
 * `fetchRef.impl` is indirected through an object so a test can prime the cache
 * over a working network and then take the network away from the *same* worker
 * instance — which is the only honest way to test the offline fallback.
 */
function loadWorker(fetchRef: { impl: (request: FakeRequest) => Promise<Response> }) {
  const handlers: Handlers = {};
  const { api: cachesApi, raw } = makeCaches();
  const calls = { fetches: 0 };

  const self = {
    location: { origin: "https://jobstrackr.in" },
    addEventListener: (type: string, handler: (event: FakeEvent) => void) => {
      handlers[type] = handler;
    },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };

  const fetchImpl = (request: FakeRequest) => {
    calls.fetches += 1;
    return fetchRef.impl(request);
  };

  /**
   * The only way to execute the worker as what it actually is.
   *
   * `sw.js` is a classic script served from `public/`, not a module: it has no
   * exports, and it wires itself up through `self.addEventListener` at top
   * level. It cannot be imported, and rewriting it so that it could would mean
   * testing a different file from the one the browser runs — which is the whole
   * value of this suite.
   *
   * The lint rule is about evaluating attacker-influenced strings. The string
   * here is a file read from this repository at test time, in a Node test
   * process, with a hand-built scope passed in as arguments.
   */
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- see above
  const factory = new Function(
    "self",
    "caches",
    "fetch",
    "Request",
    "Response",
    "URL",
    "Headers",
    swSource,
  ) as (...args: unknown[]) => void;

  factory(self, cachesApi, fetchImpl, FakeRequest, Response, URL, Headers);

  return { handlers, caches: raw, calls };
}

/** Drives the fetch handler and reports whether the worker answered at all. */
async function handleFetch(
  handlers: Handlers,
  request: FakeRequest,
): Promise<{ handled: boolean; response?: Response }> {
  let responded: Promise<Response> | Response | undefined;
  const waits: Promise<unknown>[] = [];

  handlers.fetch?.({
    request,
    respondWith: (r) => {
      responded = r;
    },
    waitUntil: (p) => waits.push(p),
  });

  await Promise.all(waits);
  if (responded === undefined) return { handled: false };
  return { handled: true, response: await responded };
}

const navigation = (path: string) =>
  new FakeRequest(`https://jobstrackr.in${path}`, { mode: "navigate" });

describe("service worker", () => {
  let handlers: Handlers;
  let caches: Map<string, FakeCache>;
  let fetchRef: { impl: (request: FakeRequest) => Promise<Response> };

  /** Replaces what the network returns for the rest of the current test. */
  const serve = (body: string, init?: ResponseInit) => {
    fetchRef.impl = () => Promise.resolve(basic(body, init));
  };

  beforeEach(() => {
    fetchRef = { impl: () => Promise.resolve(basic("<html>page</html>", { status: 200 })) };
    const loaded = loadWorker(fetchRef);
    handlers = loaded.handlers;
    caches = loaded.caches;
  });

  const pageCache = () => [...caches.entries()].find(([n]) => n.startsWith("jt-pages"))?.[1];
  const storedPaths = () =>
    [...(pageCache()?.store.keys() ?? [])].map((u) => new URL(u).pathname);

  it("registers install, activate and fetch handlers", () => {
    expect(Object.keys(handlers).sort()).toEqual(["activate", "fetch", "install"]);
  });

  it("precaches the offline page at install", async () => {
    const waits: Promise<unknown>[] = [];
    handlers.install?.({
      respondWith: () => undefined,
      waitUntil: (p) => waits.push(p),
    });
    await Promise.all(waits);

    const staticCache = [...caches.entries()].find(([n]) => n.startsWith("jt-static"))?.[1];
    const paths = [...(staticCache?.store.keys() ?? [])];
    expect(paths.some((p) => p.includes("/offline"))).toBe(true);
  });

  /* ── The security boundary ─────────────────────────────────────────────── */

  /**
   * The home page reads the session and renders the viewer's tracked exams, so
   * a cached copy is one person's dashboard handed to the next. It is the most
   * public-*looking* route in the app, which is exactly why it is asserted.
   */
  it("never stores the home page, which is personalised despite looking public", async () => {
    const { handled } = await handleFetch(handlers, navigation("/"));
    expect(handled).toBe(true);
    expect(storedPaths()).not.toContain("/");
  });

  it("never stores /calendar, which renders the viewer's saved exams", async () => {
    await handleFetch(handlers, navigation("/calendar"));
    expect(storedPaths()).not.toContain("/calendar");
  });

  it.each([
    "/profile",
    "/tracker",
    "/for-you",
    "/my-details",
    "/documents",
    "/saved",
    "/admin",
  ])("never stores the account route %s", async (path) => {
    await handleFetch(handlers, navigation(path));
    expect(storedPaths()).not.toContain(path);
  });

  it("refuses to store an allowlisted page whose response declares itself private", async () => {
    serve("<html>page</html>", {
      status: 200,
      headers: { "Cache-Control": "private, max-age=0" },
    });
    await handleFetch(handlers, navigation("/jobs"));
    expect(storedPaths()).not.toContain("/jobs");
  });

  it("refuses to store a page that varies by cookie", async () => {
    serve("<html>page</html>", { status: 200, headers: { Vary: "Cookie" } });
    await handleFetch(handlers, navigation("/updates"));
    expect(storedPaths()).not.toContain("/updates");
  });

  /* ── What it should keep ───────────────────────────────────────────────── */

  it.each(["/jobs", "/updates", "/syllabus", "/quiz", "/terms-of-service"])(
    "stores the public page %s",
    async (path) => {
      await handleFetch(handlers, navigation(path));
      expect(storedPaths()).toContain(path);
    },
  );

  it("stores a job detail page, not just the list", async () => {
    await handleFetch(handlers, navigation("/jobs/some-exam-2026"));
    expect(storedPaths()).toContain("/jobs/some-exam-2026");
  });

  it("does not store a failed response", async () => {
    serve("nope", { status: 500 });
    await handleFetch(handlers, navigation("/jobs"));
    expect(storedPaths()).not.toContain("/jobs");
  });

  /* ── What it must not touch at all ─────────────────────────────────────── */

  it("ignores non-GET requests", async () => {
    const { handled } = await handleFetch(
      handlers,
      new FakeRequest("https://jobstrackr.in/jobs", { method: "POST" }),
    );
    expect(handled).toBe(false);
  });

  it("ignores cross-origin requests", async () => {
    const { handled } = await handleFetch(
      handlers,
      new FakeRequest("https://example.supabase.co/rest/v1/jobs"),
    );
    expect(handled).toBe(false);
  });

  it("ignores API routes", async () => {
    const { handled } = await handleFetch(
      handlers,
      new FakeRequest("https://jobstrackr.in/api/jobs"),
    );
    expect(handled).toBe(false);
  });

  /**
   * An RSC payload is coupled to the build that produced it, so serving a stale
   * one breaks client-side navigation in ways that read as data corruption
   * rather than as a caching bug.
   */
  it("ignores RSC payload requests", async () => {
    const { handled } = await handleFetch(
      handlers,
      new FakeRequest("https://jobstrackr.in/jobs?_rsc=abc123", { mode: "navigate" }),
    );
    expect(handled).toBe(false);
  });

  /* ── Immutable assets ──────────────────────────────────────────────────── */

  it("serves hashed build assets cache-first, and only fetches them once", async () => {
    const loaded = loadWorker({ impl: () => Promise.resolve(basic("chunk", { status: 200 })) });

    const asset = new FakeRequest("https://jobstrackr.in/_next/static/chunks/abc.js");
    await handleFetch(loaded.handlers, asset);
    await handleFetch(loaded.handlers, asset);

    expect(loaded.calls.fetches).toBe(1);
  });

  it("serves brand artwork cache-first", async () => {
    const { handled } = await handleFetch(
      handlers,
      new FakeRequest("https://jobstrackr.in/brand/app-icon-192.png"),
    );
    expect(handled).toBe(true);
  });

  /* ── Offline behaviour ─────────────────────────────────────────────────── */

  it("serves the stored copy of a visited page when the network later fails", async () => {
    await handleFetch(handlers, navigation("/jobs"));

    // Same worker, same caches — only the network is taken away.
    fetchRef.impl = () => Promise.reject(new Error("offline"));
    const { handled, response } = await handleFetch(handlers, navigation("/jobs"));

    expect(handled).toBe(true);
    expect(await response?.text()).toContain("page");
  });

  it("falls back to the precached offline page for somewhere never visited", async () => {
    const waits: Promise<unknown>[] = [];
    handlers.install?.({ respondWith: () => undefined, waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);

    fetchRef.impl = () => Promise.reject(new Error("offline"));
    const { handled, response } = await handleFetch(handlers, navigation("/syllabus"));

    expect(handled).toBe(true);
    expect(await response?.text()).toBe("precached");
  });

  /* ── Versioning ────────────────────────────────────────────────────────── */

  /**
   * Every cache is namespaced with `VERSION` and `activate` deletes the rest.
   * Without that, a rename of the offline page would leave the old one cached
   * with no way to evict it — and no redeploy can reach a worker's cache.
   */
  it("evicts its own caches from other versions on activate", async () => {
    const loaded = loadWorker({ impl: () => Promise.resolve(basic("x")) });
    loaded.caches.set("jt-static-vOLD", await makeCaches().api.open("stale"));

    const waits: Promise<unknown>[] = [];
    loaded.handlers.activate?.({
      respondWith: () => undefined,
      waitUntil: (p) => waits.push(p),
    });
    await Promise.all(waits);

    expect([...loaded.caches.keys()]).not.toContain("jt-static-vOLD");
  });

  it("namespaces every cache so a version bump cannot collide", () => {
    expect(swSource).toMatch(/const VERSION = "v\d+"/);
    expect(swSource).toContain("jt-static-${VERSION}");
    expect(swSource).toContain("jt-pages-${VERSION}");
  });
});
