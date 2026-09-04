import Link from "next/link";
import type { ComponentType, SVGProps } from "react";

import { BookmarkIcon, CalendarIcon, MegaphoneIcon, SparklesIcon } from "@/components/icons";
import { CardInteractive } from "@/components/ui/card";

/**
 * The four destinations that are not "a list of jobs".
 *
 * The sidebar and the bottom bar both already link to these, and that is
 * precisely the problem this solves: a nav item is a word, and "For You" and
 * "Calendar" are words that tell a first-time visitor nothing. Each tile here
 * gets a sentence, so the page explains its own navigation once, at the point
 * where someone is deciding where to go.
 *
 * Four, not eight. The set is the routes a person cannot reach by tapping a job
 * — Jobs and Updates are one scroll below this, and Profile is a settings
 * screen, not a destination.
 */
const LINKS: {
  href: string;
  label: string;
  blurb: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}[] = [
  {
    href: "/for-you",
    label: "For You",
    blurb: "Jobs you are actually eligible for",
    icon: SparklesIcon,
  },
  {
    href: "/calendar",
    label: "Calendar",
    blurb: "Every exam date on one page",
    icon: CalendarIcon,
  },
  {
    href: "/updates",
    label: "Updates",
    blurb: "Admit cards, results, answer keys",
    icon: MegaphoneIcon,
  },
  {
    href: "/saved",
    label: "Saved",
    blurb: "Your shortlist, kept in one place",
    icon: BookmarkIcon,
  },
];

export function QuickLinks() {
  return (
    <nav aria-label="Sections" className="mt-6">
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {LINKS.map(({ href, label, blurb, icon: Icon }) => (
          <li key={href}>
            <CardInteractive className="group h-full p-3.5">
              {/* The icon tile is the only tinted square in the app, and it is
                  `accent-soft` rather than a per-item colour. The old app gave
                  each nav item its own hue — rose, amber, emerald, blue, violet
                  — which reads as playful, and playful is the wrong register
                  for "you have three days left to apply". */}
              <span
                className={
                  "flex size-9 items-center justify-center rounded-lg border border-accent-line " +
                  "bg-accent-soft text-accent transition-colors duration-(--duration-fast) " +
                  "group-hover:bg-accent group-hover:text-on-accent"
                }
              >
                <Icon className="size-[1.15rem]" />
              </span>

              <p className="mt-3 text-sm font-semibold text-ink">
                <Link href={href} className="after:absolute after:inset-0">
                  {label}
                </Link>
              </p>
              <p className="mt-0.5 text-xs leading-snug text-ink-3">{blurb}</p>
            </CardInteractive>
          </li>
        ))}
      </ul>
    </nav>
  );
}
