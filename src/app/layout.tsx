import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Public_Sans } from "next/font/google";

import { AppShell } from "@/components/shell/app-shell";
import { ThemeScript } from "@/components/shell/theme-script";
import "./globals.css";

// Self-hosted at build time by next/font: no runtime request to Google, so no
// render-blocking third-party round trip, no CSP entry, and no layout shift
// when the face swaps in.
const publicSans = Public_Sans({
  subsets: ["latin"],
  variable: "--font-public-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://jobstrackr.in"),
  title: {
    default: "JobsTrackr — Government jobs and exam updates",
    template: "%s · JobsTrackr",
  },
  description:
    "Government job notifications, exam updates, and eligibility tracking for Indian competitive exams.",
  applicationName: "JobsTrackr",
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafbfc" },
    { media: "(prefers-color-scheme: dark)", color: "#101319" },
  ],
  // Zoom is not disabled. Capping it is a common default and an accessibility
  // failure — plenty of people need to pinch-zoom a deadline table.
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className={`${publicSans.variable} ${jetbrainsMono.variable}`}>
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
      </body>
    </html>
  );
}
