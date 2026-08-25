import type { Instrumentation } from "next";
import * as Sentry from "@sentry/nextjs";

/**
 * Error reporting.
 *
 * Until now nothing reported anything: a server render that threw produced a
 * digest in the response and a line in a Vercel log nobody reads, and the two
 * were never connected. This wires both halves — the report and the digest that
 * identifies it — without putting a byte in the browser.
 *
 * ## Server and edge only, deliberately
 *
 * There is no `instrumentation-client.ts`, so the browser SDK is never loaded.
 * That is a real trade, made on this app's shape rather than by habit:
 *
 *   - Cause #7 of this rebuild was bundle bloat, and the budget currently has
 *     ~2.6 kB of headroom per route. Sentry's browser SDK is an order of
 *     magnitude more than that, so adopting it means raising the budget by
 *     roughly 20% for every page — the exact move this project exists to stop.
 *   - 433 of the app's pages are static HTML with a handful of small client
 *     islands. Almost everything that can fail, fails on the server: a query,
 *     a render, a server action, a route handler. Those are all covered here.
 *
 * What this does *not* catch is an exception thrown inside a client island
 * after hydration. `error.tsx` still shows the reader something useful when
 * that happens, and the failure is visible in their console — it just does not
 * reach a dashboard. If client-side visibility is later judged worth ~30 kB a
 * route, adding `instrumentation-client.ts` is the whole change, and the budget
 * raise should be argued for on its own terms in that commit.
 *
 * ## Without a DSN
 *
 * `Sentry.init` with an empty DSN disables the SDK: it becomes a no-op rather
 * than an error. So this file is safe to ship before the account exists, and
 * starts working the moment `NEXT_PUBLIC_SENTRY_DSN` is set in Vercel — no
 * code change, no redeploy of anything but the env var.
 */
export function register() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,

    // The free tier is 5k events a month and this app serves ~30 people a day,
    // so errors are sampled at 100% — every one of them is worth seeing. Traces
    // are off: performance data is what would actually exhaust that quota, and
    // the numbers that matter here are already gated in CI by the bundle and
    // traffic budgets.
    tracesSampleRate: 0,

    // Supabase URLs carry the project ref and query strings carry search terms.
    // Neither belongs in a third-party error report.
    sendDefaultPii: false,
  });
}

/**
 * Next calls this for every uncaught server-side error, with the `digest` it
 * showed the user. Recording that digest is the point: it is the only string
 * connecting "reference 1142199457" on someone's screen to the stack trace that
 * produced it.
 */
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.captureRequestError(err, request, context);
    return;
  }

  // No DSN yet — still make the failure findable. Vercel captures stderr, and a
  // single JSON line is greppable in a way a multi-line stack is not.
  console.error(
    JSON.stringify({
      event: "request_error",
      digest: (err as { digest?: string }).digest,
      path: request.path,
      method: request.method,
      router: context.routerKind,
      route: context.routePath,
      type: context.routeType,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );
};
