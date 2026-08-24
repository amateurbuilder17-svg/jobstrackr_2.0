import type { NextConfig } from "next";

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
    // Long-lived because the answer is stable for months, but not permanent:
    // enabling Google should light up its button without a redeploy.
    config: {
      stale: 60 * 15, // 15 minutes
      revalidate: 60 * 60, // 1 hour
      expire: 60 * 60 * 24, // 1 day
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
      { source: "/search", destination: "/jobs", permanent: true },
      { source: "/trending", destination: "/updates", permanent: true },
      { source: "/for-you/shelf/:key", destination: "/for-you", permanent: true },
      { source: "/settings/notifications", destination: "/profile", permanent: true },
      { source: "/edit-profile", destination: "/profile", permanent: true },
      { source: "/edit-education", destination: "/profile", permanent: true },
      { source: "/edit-sector-preferences", destination: "/profile", permanent: true },
      { source: "/user-manual", destination: "/help", permanent: true },
      // The old app served the SPA shell here; both are now real routes.
      { source: "/syllabus/result", destination: "/syllabus", permanent: true },
    ];
  },

  // Applied to every route. The CSP is intentionally absent here — it is built
  // per-request with a nonce in middleware (Module 12), because a static CSP
  // strong enough to be useful cannot allow Next.js's inline bootstrap script.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
