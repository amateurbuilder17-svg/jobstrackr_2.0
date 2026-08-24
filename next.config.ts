import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // This project currently sits inside the old repository's directory tree, so
  // Turbopack's lockfile-based root inference walks up and picks the wrong one.
  // Pin it explicitly. Safe to delete once this moves to its own repo.
  turbopack: { root: import.meta.dirname },

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
