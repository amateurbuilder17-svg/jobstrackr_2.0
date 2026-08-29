import type { NextConfig } from "next";

/**
 * The policy, as a single header value.
 *
 * `connect-src` names the Supabase origin explicitly rather than allowing
 * https: — the browser should refuse to send this app's session anywhere else,
 * and a wildcard would make an exfiltration bug invisible.
 */
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

/**
 * React's development build calls `eval()` for debugging — reconstructing
 * callstacks across environments — and says so in the console when a CSP blocks
 * it. It never does this in production, so the allowance is scoped to dev
 * rather than weakened everywhere. The Module 12 gate is about the policy that
 * ships, and `unsafe-eval` is absent from it.
 */
const isDev = process.env.NODE_ENV !== "production";

const contentSecurityPolicy = [
  "default-src 'self'",
  // No 'unsafe-eval' in production. Next's inline bootstrap needs
  // 'unsafe-inline' in both; see above.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigin} https://*.supabase.co wss://*.supabase.co`,
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  /**
   * Production only, and that is a Safari bug rather than a preference.
   *
   * This directive tells the browser to rewrite every `http://` request as
   * `https://`. In production that is free — Vercel serves nothing over plain
   * http — but in development the app is served from `http://localhost`, and
   * the two engines disagree about what to do with that.
   *
   * Chrome follows the carve-out for potentially-trustworthy origins and
   * leaves localhost alone. WebKit upgrades it anyway, so in Safari every
   * stylesheet, script, font and Supabase call this app makes is reissued to
   * `https://localhost:<port>` — where no TLS listener exists. The page
   * arrives unstyled and inert, which is the whole of "it does not open
   * correctly in Safari".
   *
   * Dropping it in dev costs nothing: there is no mixed content to upgrade on
   * a loopback origin, which is precisely why the carve-out exists.
   */
  isDev ? "" : "upgrade-insecure-requests",
]
  .filter(Boolean)
  .join("; ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  cacheComponents: true,

  // This project currently sits inside the old repository's directory tree, so
  // Turbopack's lockfile-based root inference walks up and picks the wrong one.
  // Pin it explicitly. Safe to delete once this moves to its own repo.
  turbopack: { root: import.meta.dirname },

  /**
   * Cache profiles.
   *
   * The default profiles revalidate on a timer, which is the wrong trigger
   * here — content changes when ingestion says it does, not on the hour. The
   * profiles below make time a *safety net* rather than the mechanism:
   * `revalidateTag` from the sync worker is what actually refreshes a page, and
   * the long revalidate window only bounds how stale things could get if an
   * invalidation were ever missed.
   *
   *   stale      how long a client may reuse its copy before revalidating
   *   revalidate background refresh interval on the server
   *   expire     hard ceiling; past this the page must be re-rendered
   */
  cacheLife: {
    // Job and update pages. Data changes a few times a day at most.
    content: {
      stale: 60 * 60, // 1 hour
      revalidate: 60 * 60 * 24, // 1 day
      expire: 60 * 60 * 24 * 30, // 30 days
    },
    // Lists and feeds — new notifications should surface promptly even if a
    // tag invalidation goes missing.
    feed: {
      stale: 60 * 5, // 5 minutes
      revalidate: 60 * 60 * 6, // 6 hours
      expire: 60 * 60 * 24 * 7, // 7 days
    },
    // Project configuration that changes when someone edits a dashboard
    // setting — which external auth providers are enabled, and little else.
    // Short, despite the answer being stable for months, because of what it
    // controls: a stale "Google is off" takes the fastest way to sign in off
    // the page, and one probe every few minutes is nothing next to that.
    config: {
      stale: 60, // 1 minute
      revalidate: 60 * 5, // 5 minutes
      expire: 60 * 30, // 30 minutes
    },
  },

  // A build that type-errors must fail. This defaults to false already; it is
  // pinned explicitly so nobody "unblocks a deploy" by flipping it later
  // without it showing up in review. (Next 16 dropped the matching `eslint`
  // key along with `next lint` — linting is its own CI step now.)
  typescript: { ignoreBuildErrors: false },

  // Trims the response body on every rendered page.
  poweredByHeader: false,
  compress: true,

  images: {
    // AVIF first — roughly 30% smaller than WebP at equal quality, and image
    // bytes are the largest line item in the Vercel bandwidth budget.
    formats: ["image/avif", "image/webp"],
    // Remote hosts get added per-module, as each one is actually needed.
    remotePatterns: [],
  },

  /**
   * Redirects from the old app's URL shapes.
   *
   * The domain is unchanged and roughly 5,200 job pages are indexed under
   * these paths, so the SEO surface is the most valuable thing the old app
   * built — and the one asset a careless cutover destroys outright. Every
   * shape that moved gets a 301 (permanent), so ranking signal transfers
   * rather than being rediscovered.
   *
   * The two id-based shapes — /job/:uuid and /exam-update/:id — cannot be
   * expressed here because they need a database lookup to find the new slug.
   * They are handled by route handlers that look up and redirect.
   */
  async redirects() {
    return [
      // Renamed surfaces.
      { source: "/search", destination: "/jobs", permanent: true },
      { source: "/trending", destination: "/updates", permanent: true },
      { source: "/auth", destination: "/sign-in", permanent: true },
      { source: "/welcome", destination: "/", permanent: true },
      // /more was the old app's menu page. /menu is its successor, so this is
      // the one legacy redirect that points at a like-for-like replacement.
      { source: "/more", destination: "/menu", permanent: true },
      { source: "/for-you/shelf/:key", destination: "/for-you", permanent: true },

      // The old app split profile editing across four screens; it is one now.
      { source: "/settings/notifications", destination: "/profile", permanent: true },
      { source: "/edit-profile", destination: "/profile", permanent: true },
      { source: "/edit-education", destination: "/profile", permanent: true },
      { source: "/edit-sector-preferences", destination: "/profile", permanent: true },
      { source: "/documents", destination: "/profile", permanent: true },

      // /countdown, /countdown/live and /countdown/:slug used to redirect to
      // /calendar, on the grounds that the calendar answered the same question.
      // The countdown is rebuilt (plan M27) and the redirects are gone with it;
      // `redirects.test.ts` is what caught them still standing.

      // FormMate is not rebuilt yet (plan M24). Until it is, the jobs list is
      // where someone looking for it actually wants to end up.
      { source: "/formmate", destination: "/jobs", permanent: true },

      // /user-manual, /faq, /help and /syllabus were all listed here, pointing
      // at "/" or at a category filter, on the grounds that they did not exist
      // in this app. They exist now, and the redirects had to come out with the
      // pages going in — a 301 shadows its own route completely, so the pages
      // built, passed every check, appeared in the sitemap, and were reachable
      // by nobody. `redirects.test.ts` now fails if that recurs.
      //
      // The old syllabus result page took its exam in a query string; results
      // are addressable now, so the only honest destination is the search.
      { source: "/syllabus/result", destination: "/syllabus", permanent: true },

      // Retired endpoints, still called by the old Apps Script and by crawlers.
      { source: "/api/cache/:key", destination: "/jobs", permanent: true },
      { source: "/api/scrape", destination: "/jobs", permanent: true },
      { source: "/api/discover", destination: "/jobs", permanent: true },
      { source: "/api/scrape-article", destination: "/jobs", permanent: true },
      { source: "/api/scrape-article-links", destination: "/jobs", permanent: true },
      { source: "/api/sync-sheets", destination: "/api/sync", permanent: true },
    ];
  },

  // Applied to every route. The CSP is intentionally absent here — it is built
  // ── Content Security Policy ──────────────────────────────────────────────
  // Static, not nonce-based, and that is a decision rather than a shortcut.
  //
  // A nonce has to be generated per request, which means middleware on every
  // route — including all 438 statically generated pages whose entire purpose
  // is to be served from the CDN without invoking anything. That is cause #6 of
  // this rebuild, reintroduced by the security layer. Worse, it would not even
  // work: a nonce embedded in cached HTML is served to every visitor, and a
  // nonce everyone shares is not a nonce.
  //
  // So the policy is static and strict everywhere it can be. `unsafe-eval` is
  // absent — that is the one the Module 12 gate names, and it is what stops a
  // string becoming code. `unsafe-inline` stays for scripts only, because
  // Next's bootstrap is an inline script in every prerendered document; the
  // honest alternative is per-request rendering, which costs more than it buys
  // here. Styles are inline too (Tailwind's critical CSS).
  //
  // Everything else is closed: no plugins, no framing, no form posts off-site,
  // and connections limited to Supabase.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // Also production only. A browser is required to ignore HSTS
          // received over plain http, so sending it from a localhost dev
          // server is at best a no-op — and it is the second header that,
          // taken at face value, says "never speak http to this host again".
          // There is no reason to ship an instruction to dev that only makes
          // sense in production.
          ...(isDev
            ? []
            : [
                {
                  key: "Strict-Transport-Security",
                  value: "max-age=63072000; includeSubDomains; preload",
                },
              ]),
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          // Defence for the same class of problem from the other direction:
          // stops this origin being loaded as a resource by another site.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ];
  },
};

export default nextConfig;
