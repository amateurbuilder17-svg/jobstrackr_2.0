import type { Metadata } from "next";

/**
 * The page the service worker serves when the network is gone and it has no
 * stored copy of what was asked for.
 *
 * Two constraints shape it, and both point the same way — keep it plain:
 *
 *   1. It is precached at install, so its weight is paid by every visitor who
 *      installs the app, whether or not they ever go offline.
 *   2. It has to render with no network at all, which rules out anything
 *      fetched at view time.
 *
 * It does render inside the app shell, because the shell is in the root layout
 * and this is an ordinary route. That was worth checking rather than assuming:
 * `SessionProvider` fetches on mount, which offline must fail, and a fallback
 * page that itself looks broken would be worse than the browser's own error
 * screen. It wraps that fetch in `try`/`catch` and settles into the signed-out
 * state, so the frame around this copy is inert but intact — the nav still
 * works, and every destination in it that has been visited is in the worker's
 * page cache.
 *
 * `noindex` because it is a client-side artefact, not content. Left out of the
 * sitemap for the same reason.
 *
 * No "Retry" button: it would be a client component, and the browser's own
 * reload does the same job. The list below is the useful part — offline, what
 * you can still reach is not obvious, and the service worker's page cache makes
 * it a real answer rather than a consolation.
 */
export const metadata: Metadata = {
  title: "You are offline",
  description: "JobsTrackr could not reach the network.",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6">
      <p className="cond text-[11px] font-bold tracking-[0.15em] text-ink-3 uppercase">
        No connection
      </p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">You are offline</h1>
      <p className="mt-2 text-ink-2">
        This page has not been opened on this device before, so there is no saved copy to show
        you. Pages you have already visited will still open.
      </p>
      <p className="mt-4 text-sm text-ink-3">
        Reload once you are back on a network and this will go straight through.
      </p>
    </main>
  );
}
