import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Public_Sans } from "next/font/google";
import "./globals.css";

// Self-hosted at build time by next/font — no request to fonts.googleapis.com
// at runtime, so no render-blocking third-party round trip and no CSP entry.
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
  // Resolves every relative URL in OG tags, canonicals and the sitemap.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://jobstrackr.in"),
  title: {
    default: "JobsTrackr",
    template: "%s · JobsTrackr",
  },
  description: "Government job notifications, exam updates and eligibility tracking.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#101319" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${publicSans.variable} ${jetbrainsMono.variable}`}>{children}</body>
    </html>
  );
}
