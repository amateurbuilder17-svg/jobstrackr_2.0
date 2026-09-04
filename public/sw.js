/*
 * JobsTrackr service worker.
 *
 * Hand-written, and deliberately small. The alternative was Serwist or
 * next-pwa, and both bring a precache-manifest build step whose defaults
 * cache-first navigation HTML — which is exactly the one thing this app must
 * not do, because 438 of its pages are partially prerendered and a stale shell
 * served from a client cache is indistinguishable from a broken deploy.
 *
 * The rules, in the order the fetch handler applies them:
 *
 *   1. Anything that is not a same-origin GET is left entirely alone.
 *   2. `/_next/static/*` and `/brand/*` are cache-first. Both are immutable —
 *      the first is content-hashed by the bundler, the second is versioned by
 *      filename — so a hit can never be wrong, and this is where the repeat-
 *      visit speed comes from.
 *   3. Navigations are network-first, falling back to a cached copy and then to
 *      the offline page. Never cache-first: see above.
 *   4. Everything else — API routes, RSC payloads, Supabase — is network-only.
 *
 * ## Why the navigation allowlist exists
 *
 * A service worker cache is shared by everyone who uses the browser profile, and
 * it outlives the session. So caching a page that renders someone's own data is
 * how a shared phone shows one person another person's tracker. The allowlist
 * below is therefore a security boundary, not an optimisation: only routes whose
 * HTML is genuinely identical for every visitor are storable.
 *
 * This is safe to assert here because the app shell renders no user-specific
 * state — the profile button and the save buttons are hydrated from a client
 * fetch, which is why `src/proxy.ts` can keep its matcher off these routes and
 * let them stay CDN-served. Account routes render their data on the server and
 * are all excluded.
 */

/**
 * Bump on any change to this file or to what it precaches.
 *
 * Every cache this worker owns is namespaced with it, and `activate` deletes
 * every namespace that is not the current one. Without that, a rename of the
 * offline page would leave the old one cached forever with no way to evict it.
 */
const VERSION = "v1";
const STATIC_CACHE = `jt-static-${VERSION}`;
const PAGE_CACHE = `jt-pages-${VERSION}`;
const OFFLINE_URL = "/offline";

/** Precached at install, so the offline page works on the very first outage. */
const PRECACHE = [OFFLINE_URL, "/brand/app-icon-192.png"];

/**
 * Routes whose HTML is the same for every visitor, and may therefore be stored.
 *
 * Prefix matches. Deliberately a list of what IS public rather than a list of
 * what is not: a new account route added later is excluded by default, which is
 * the direction this decision has to fail in.
 *
 * Every entry here was checked for a server-side `getUser()` call. Two obvious
 * candidates are absent because they failed that check, and both are worth
 * naming so nobody adds them back:
 *
 *   `/`         calls `getUser()` and renders a tracked-exams section. The home
 *               page looks public and is not.
 *   `/calendar` reads the signed-in user's saved and tracked exams, and renders
 *               `SignInRequired` when there is nobody.
 *
 * `/menu` *is* here, because its own comment records that nothing on it reads
 * the session on the server.
 */
const PUBLIC_PAGES = [
  "/jobs",
  "/updates",
  "/syllabus",
  "/countdown",
  "/quiz",
  "/menu",
  "/feedback",
  "/help",
  "/faq",
  "/user-manual",
  "/privacy-policy",
  "/terms-of-service",
  "/refund-policy",
];

const isPublicPage = (pathname) =>
  pathname === OFFLINE_URL ||
  PUBLIC_PAGES.some((p) => pathname === p || pathname.startsWith(`${p}/`));

/**
 * A second opinion, taken from the response rather than the URL.
 *
 * The allowlist above is a static claim about routes, and static claims rot —
 * the whole reason it needed writing is that `/` became personalised without
 * looking like it had. This reads what the server actually said: `private` is
 * the standard way a response declares itself single-user, and `Vary: Cookie`
 * means the body depends on who asked. Either one vetoes the store even if the
 * path is allowlisted.
 *
 * It cannot see `Set-Cookie` — the Fetch spec hides that from script — so this
 * narrows the window rather than closing it. The allowlist is still the primary
 * control.
 */
function isStorable(response) {
  const cc = response.headers.get("Cache-Control") ?? "";
  if (/\bprivate\b|\bno-store\b/i.test(cc)) return false;

  const vary = response.headers.get("Vary") ?? "";
  if (/\bcookie\b|\bauthorization\b/i.test(vary)) return false;

  return true;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // Individually, not `addAll`: one 404 in the list would otherwise reject
      // the whole install and leave the app with no worker at all.
      await Promise.all(
        PRECACHE.map(async (url) => {
          try {
            await cache.add(new Request(url, { cache: "reload" }));
          } catch {
            /* A missing precache entry degrades offline; it must not break install. */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith("jt-") && k !== STATIC_CACHE && k !== PAGE_CACHE)
          .map((k) => caches.delete(k)),
      );
      // Take over open tabs now rather than on their next navigation. Paired
      // with `skipWaiting` above, this is what stops a released fix sitting
      // behind an old worker until the user closes every tab.
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // RSC payloads are per-navigation and version-coupled to the running build;
  // a cached one breaks client-side routing in ways that look like data bugs.
  if (url.searchParams.has("_rsc") || request.headers.get("RSC")) return;

  if (url.pathname.startsWith("/api/")) return;

  // Immutable by construction — hashed filenames, or names carrying their own
  // dimensions. A cache hit here cannot be stale.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/brand/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirstPage(request, url));
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  // `response.ok` excludes 404s; `basic` excludes opaque cross-origin replies,
  // which cannot be inspected and so cannot be judged safe to keep.
  if (response.ok && response.type === "basic") {
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstPage(request, url) {
  const cache = await caches.open(PAGE_CACHE);

  try {
    const response = await fetch(request);
    if (response.ok && isPublicPage(url.pathname) && isStorable(response)) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline, or the network failed outright. A previously stored copy of this
    // exact page is the best answer; the offline page is the honest fallback.
    const hit = await cache.match(request);
    if (hit) return hit;

    const offline = await (await caches.open(STATIC_CACHE)).match(OFFLINE_URL);
    if (offline) return offline;

    return new Response("You are offline.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
