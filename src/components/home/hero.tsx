import Link from "next/link";

import { BellIcon, CheckIcon, ChevronRightIcon, SparkIcon } from "@/components/icons";

/**
 * The one branded surface on the site.
 *
 * Everything else in this design system is deliberately quiet — hairline rules,
 * no shadows, one accent held back for genuine state. That restraint is correct
 * for a list of deadlines and wrong for the first screen a stranger sees, which
 * has about two seconds to say what this is. So the hero is the single place
 * allowed to carry a filled colour field, and it earns that by being one
 * object rather than a treatment applied to every card below it.
 *
 * ── Why the green is hard-coded rather than `bg-accent` ───────────────────
 * `--color-accent` inverts in dark mode: seal green becomes a light mint, and a
 * mint-filled panel would make the hero the brightest object on a dark page —
 * the opposite of the weight it should carry. A deep green reads correctly on
 * both grounds, so the panel keeps one value across themes and only the
 * surrounding page changes. The token contract is untouched; this is a literal,
 * not a redefinition.
 *
 * No data, no cookies, no `await`. The hero is pure markup so it prerenders
 * into the static shell and paints from the CDN before any query resolves.
 */
export function Hero() {
  return (
    <section
      className={
        "relative isolate overflow-hidden rounded-xl px-5 py-8 sm:px-10 sm:py-14 " +
        "bg-[oklch(30%_0.052_170)] bg-linear-160 from-[oklch(34%_0.058_168)] " +
        "via-[oklch(29%_0.05_170)] to-[oklch(24%_0.038_172)]"
      }
    >
      {/* Two decorative layers, both `aria-hidden` and both pointer-transparent.
          The grid is a ledger rule, at the opacity where it reads as texture
          rather than as a table; the glow lifts the top-left corner so the
          panel does not read as a flat rectangle of paint. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #fff 1px, transparent 1px)," +
            "linear-gradient(to bottom, #fff 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(120% 100% at 15% 0%, #000 30%, transparent 75%)",
        }}
      />
      <div
        aria-hidden
        className={
          "pointer-events-none absolute -top-24 -left-16 -z-10 size-72 rounded-full " +
          "bg-[oklch(72%_0.11_165)] opacity-20 blur-3xl"
        }
      />

      <p
        className={
          "inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 " +
          "px-3 py-1 text-2xs font-medium tracking-wide text-white/85 uppercase"
        }
      >
        {/* A live dot, not an animated one. `animate-pulse` on a first-paint
            element is motion nobody asked for, and it is the kind of detail that
            reads as decoration on a page about deadlines. */}
        <span className="size-1.5 rounded-full bg-[oklch(78%_0.13_163)]" />
        Checked every day
      </p>

      <h1 className="mt-5 max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-4xl">
        Every government job,{" "}
        {/* The one phrase the page is actually about, lifted out of the
            headline. A colour change carries it without a second type size. */}
        <span className="text-[oklch(82%_0.12_164)]">without the noise</span>
      </h1>

      <p className="mt-4 max-w-prose text-white/75">
        Notifications, deadlines and eligibility for Indian competitive exams — and only the
        ones you can actually apply for.
      </p>

      {/* Full-width and stacked below `sm`, side by side above it. Left to
          wrap, the two labels are 311px on a 375px screen — one button ends up
          alone on the second line at a width nobody chose, which reads as a
          layout bug rather than as a pair of choices. */}
      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {/* Links, not buttons. An earlier version rendered these as `<Button>`
            elements with no handler and no href: the two most prominent
            controls on the site navigated nowhere. */}
        <Link
          href="/jobs"
          className={
            "group inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-white px-5 text-base " +
            "font-semibold text-[oklch(26%_0.045_170)] transition-colors " +
            "duration-(--duration-fast) hover:bg-white/90"
          }
        >
          Browse all jobs
          <ChevronRightIcon className="size-4 transition-transform duration-(--duration-fast) group-hover:translate-x-0.5" />
        </Link>
        <Link
          href="/for-you"
          className={
            "inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/25 px-5 " +
            "text-base font-medium text-white transition-colors duration-(--duration-fast) " +
            "hover:border-white/40 hover:bg-white/10"
          }
        >
          <SparkIcon className="size-4" />
          Check my eligibility
        </Link>
      </div>

      {/* Three claims about the product, not three invented statistics. A
          counter reading "12,480 jobs" would need a `count(*)` on every render
          of a page whose whole design is to be served from the CDN — and would
          be the only number on the site nobody could check. */}
      <ul className="mt-8 grid gap-2.5 border-t border-white/10 pt-5 sm:mt-9 sm:gap-3 sm:pt-6 sm:grid-cols-3">
        <HeroPoint icon={CheckIcon} title="Verified sources">
          Every listing traced to its official notification.
        </HeroPoint>
        <HeroPoint icon={SparkIcon} title="Matched to you">
          Age, qualification and stream, checked against your profile.
        </HeroPoint>
        <HeroPoint icon={BellIcon} title="Nothing missed">
          Closing dates and exam updates, tracked in one place.
        </HeroPoint>
      </ul>
    </section>
  );
}

function HeroPoint({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-[oklch(82%_0.12_164)]" />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{title}</p>
        {/* The sentence is the first thing to go on a phone. Three of them cost
            ~150px above the fold, which on a 375×812 screen is the difference
            between the first job being visible and the hero being the whole
            screen — and the three titles alone still carry the claim. */}
        <p className="mt-0.5 hidden text-xs leading-relaxed text-white/60 sm:block">
          {children}
        </p>
      </div>
    </li>
  );
}
