import Script from "next/script";

/**
 * Registers the service worker.
 *
 * An inline script rather than a Client Component, and that is a budget
 * decision as much as a style one. A component would land in the shared chunk
 * that all 22 routes download, and every route is already within a couple of
 * kilobytes of its ceiling; this is ~200 bytes of HTML in the document and adds
 * nothing to first-load JavaScript at all. It is the same reasoning — and the
 * same `next/script` mechanism — that `ThemeScript` and `SplashGate` use.
 *
 * `afterInteractive`, not `beforeInteractive`: the two siblings above have to
 * run before first paint because they decide what the first frame looks like.
 * This one decides nothing about the current page. Registering it early would
 * put a worker install in front of the content the reader is waiting for, so it
 * waits for `load` and then goes.
 *
 * Failure is swallowed on purpose. Registration throws on an insecure origin,
 * in a private window in some browsers, and where a user has disabled workers —
 * none of which is a problem this app should surface, because everything still
 * works without it. `sw.js` is what implements offline; this line is only what
 * turns it on.
 */
const REGISTER = `addEventListener('load',function(){if('serviceWorker'in navigator){navigator.serviceWorker.register('/sw.js').catch(function(){})}})`;

export function ServiceWorkerRegistration() {
  return (
    <Script id="jt-sw" strategy="afterInteractive">
      {REGISTER}
    </Script>
  );
}
