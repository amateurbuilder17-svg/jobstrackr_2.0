import Link from "next/link";

/**
 * Site footer.
 *
 * It exists so the legal pages are reachable. Three static pages with no link
 * into them are three pages nobody finds, and "there is a privacy policy, it
 * just isn't linked" satisfies nobody who is looking for one — the account
 * provider included.
 *
 * Deliberately only the legal links. The first draft also repeated Jobs,
 * Updates and Calendar, which the sidebar and the bottom nav already carry;
 * that redundancy cost ~1.9 kB on every route and put `/profile` over budget.
 * Duplicating primary navigation in a footer is a habit, not a requirement.
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
    <footer className="mt-auto border-t border-line bg-surface">
      <div className="mx-auto w-full max-w-6xl px-4 py-7 sm:px-6">
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
