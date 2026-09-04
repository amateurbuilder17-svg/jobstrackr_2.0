import type { Metadata, Viewport } from "next";
import { Archivo, Archivo_Narrow } from "next/font/google";

import { AppShell } from "@/components/shell/app-shell";
import { ServiceWorkerRegistration } from "@/components/shell/sw-register";
import { ThemeScript } from "@/components/shell/theme-script";
import { SplashGate } from "@/components/splash/splash-gate";
import "./globals.css";

// Self-hosted at build time by next/font: no runtime request to Google, so no
// render-blocking third-party round trip, no CSP entry, and no layout shift
// when the face swaps in. The CSP in next.config.ts is `font-src 'self' data:`
// with no font host, so this is not a preference — a linked stylesheet from
// fonts.googleapis.com is blocked outright.
//
// Two weight-only variable files, not one two-axis file. Archivo's width axis
// would give continuous widths from a single face, but Google serves that build
// at 90 kB against 35 kB for weight-only, and restricting the requested range
// does not shrink it. Archivo + Archivo Narrow is 53.7 kB for the two of them,
// below the 67 kB the previous pairing cost, and the design only ever used two
// widths.
const archivo = Archivo({
  subsets: ["latin"],
  variable: "--font-archivo",
  display: "swap",
});

const archivoNarrow = Archivo_Narrow({
  subsets: ["latin"],
  variable: "--font-archivo-narrow",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.jobstrackr.in"),
  title: {
    default: "JobsTrackr — Government jobs and exam updates",
    template: "%s · JobsTrackr",
  },
  description:
    "Government job notifications, exam updates, and eligibility tracking for Indian competitive exams.",
  applicationName: "JobsTrackr",
  formatDetection: { telephone: false },
  /**
   * iOS standalone behaviour.
   *
   * `capable` is what makes an installed icon open without Safari's chrome.
   * `statusBarStyle: "black-translucent"` is the one that pairs with
   * `viewportFit: "cover"` below — it hands the status bar area to the page, so
   * the header's own background runs up behind the clock instead of iOS drawing
   * an opaque bar in a colour that matches neither theme. The two settings are
   * a pair; `cover` without this leaves a grey band, and this without `cover`
   * puts content under the clock.
   *
   * `title` is the home-screen label. Without it iOS uses the `<title>` of
   * whatever page was open when the user tapped Add to Home Screen, so someone
   * installing from a job page would get that job's name on their home screen.
   */
  appleWebApp: {
    capable: true,
    title: "JobsTrackr",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f5f2" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1411" },
  ],
  // Zoom is not disabled. Capping it is a common default and an accessibility
  // failure — plenty of people need to pinch-zoom a deadline table.
  width: "device-width",
  initialScale: 1,
  /**
   * Required for `env(safe-area-inset-*)` to report anything.
   *
   * Four rules already read those insets — `bottom-nav.module.css`,
   * `menu-drawer.tsx`, `job-actions.tsx` and `update-actions.tsx` — and without
   * `cover` iOS insets the *viewport* instead, so every one of them resolved to
   * `0px` and the code was dead. This is what turns it on.
   *
   * It is a pair with the `padding-top` on the sticky header in `top-bar.tsx`:
   * `cover` lets the page run edge to edge, which is what the floating bottom
   * nav wants and what the header must explicitly opt out of, or it slides
   * under the notch. Do not set one without the other.
   */
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${archivo.variable} ${archivoNarrow.variable}`}>
        <ThemeScript />
        {/* Decides before first paint whether the home page's launch splash
            runs. Here rather than on `/` because `beforeInteractive` belongs in
            the root layout, and because "once per session" has to mean the
            session's first page load whichever route that was. */}
        <SplashGate />
        {/* Visible only on focus. The first thing a keyboard user meets should
            be a way past the navigation, not thirteen links they must tab
            through on every page. */}
        <a
          href="#content"
          className={
            "sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 " +
            "focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-sm " +
            "focus:font-medium focus:text-on-accent"
          }
        >
          Skip to content
        </a>
        <AppShell>{children}</AppShell>
        {/* Last in the body, and `afterInteractive`: the worker install must
            queue behind the page the reader actually asked for. */}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
