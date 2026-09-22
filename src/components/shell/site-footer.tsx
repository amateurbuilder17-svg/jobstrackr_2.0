import Link from "next/link";

import { BrandMark } from "@/components/brand/artwork";
import { BROWSE_LINKS } from "@/lib/hubs/catalog";

/**
 * Site footer.
 *
 * It exists so the legal pages are reachable. Three static pages with no link
 * into them are three pages nobody finds, and "there is a privacy policy, it
 * just isn't linked" satisfies nobody who is looking for one — the account
 * provider included.
 *
 * The first draft also repeated Jobs, Updates and Calendar, which the sidebar
 * and the bottom nav already carry; that redundancy cost ~1.9 kB on every
 * route and put `/profile` over budget, and it came out. Duplicating primary
 * navigation in a footer is a habit, not a requirement.
 *
 * The browse row is not that. It links the hub indexes and the two archives
 * (`lib/hubs/catalog.ts`), which nothing else links to, and it is the reason
 * every detail page on the site is a few clicks from every other page — on
 * 22 Sep 2026, before it, about 110 of ~7,900 were linked from anywhere. Five
 * plain anchors in a Server Component: markup, and no JavaScript.
 *
 * Server Component: no state, no icons, nothing added to any client bundle.
 * `mt-auto` pins it below short pages without fixed-position tricks that would
 * fight the mobile bottom nav.
 */
const LINKS = [
  { href: "/privacy-policy", label: "Privacy" },
  { href: "/terms-of-service", label: "Terms" },
  { href: "/refund-policy", label: "Refunds" },
] as const;

export function SiteFooter() {
  return (
    <footer data-shell="site-footer" className="mt-auto border-t border-line bg-surface">
      <div className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6">
        {/* The mark signs the page off. It is the last thing on every route,
            and on a phone it is the only place the brand appears once the top
            bar has given its row to the section name. */}
        <Link href="/" className="mb-4 inline-flex items-center gap-2">
          <BrandMark className="w-6" />
          <span className="text-sm font-bold tracking-tight text-ink">JobsTrackr</span>
        </Link>

        <nav aria-label="Browse" className="mb-4">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {BROWSE_LINKS.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  prefetch={false}
                  className="font-medium text-ink underline-offset-4 transition-colors hover:text-brand hover:underline"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Footer">
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            {LINKS.map(({ href, label }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="text-ink-2 underline-offset-4 transition-colors hover:text-ink hover:underline"
                >
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        {/* No year. `new Date()` here would read the clock during render, which
            under Cache Components makes every page carrying the shell dynamic —
            trading 433 static pages for a number that is wrong one day a year. */}
        <p className="mt-5 text-xs leading-relaxed text-ink-3">
          Independent aggregator, not affiliated with any government body. Confirm every date
          against the official notification. &copy; JobsTrackr
        </p>
      </div>
    </footer>
  );
}
