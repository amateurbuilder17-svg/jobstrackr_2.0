import { clsx } from "clsx";

import { LogoMark, SplashRidge } from "@/components/brand/artwork";

import styles from "./splash.module.css";

/**
 * The launch splash.
 *
 * A Server Component with no props and no state. It renders into the home
 * page's prerendered HTML — which is CDN-served — and adds nothing to any
 * route's JavaScript bundle: the timeline, the dismissal and the status
 * crossfade are all `animation` in `splash.module.css`.
 *
 * ## When it shows
 *
 * Hidden by default. `SplashGate` in the root layout sets `data-splash="show"`
 * on `<html>` before first paint, and only on the first page load of a browser
 * session; the stylesheet keys off that. Three consequences, all of them
 * intended:
 *
 *   • No flash on a repeat view. The attribute is decided before anything
 *     paints, so a returning visitor never sees a frame of the overlay — which
 *     is the failure mode of every splash that mounts and then checks.
 *   • No replay on client navigation. The gate clears the attribute once the
 *     sequence has run, so tapping Home from `/jobs` renders this markup with
 *     the overlay already hidden rather than starting the animation again.
 *   • Nothing at all without JavaScript, and nothing under
 *     `prefers-reduced-motion: reduce`. Defaulting to hidden is what makes
 *     both of those safe: the only way to get a covered page is for the gate
 *     to run and the animation to be allowed to run with it.
 *
 * `aria-hidden` and `inert` together: the first takes it out of the
 * accessibility tree, the second stops focus reaching anything inside during
 * the ~1.9 seconds it is up. There is nothing focusable in here, but that is a
 * property of today's markup rather than a guarantee.
 */
export function AppSplash() {
  return (
    <div className={styles.overlay} aria-hidden inert>
      <div className={styles.sky} />

      <div className={styles.ridge}>
        <SplashRidge className={styles.photo} />
      </div>
      <div className={styles.aurora} />
      <div className={styles.bloom} />
      <div className={styles.rays} />

      <div className={styles.hub}>
        {/* Rings and their nodes in one SVG. `vectorEffect` is deliberately
            absent — the strokes should thicken slightly as the hub scales up,
            which is what keeps them visible on a large screen. */}
        <svg className={styles.orbits} viewBox="0 0 380 380" aria-hidden>
          <circle className={styles.ringOuter} cx="190" cy="190" r="162" />
          <circle className={styles.ringInner} cx="190" cy="190" r="118" />
          <circle className={styles.node} cx="190" cy="28" r="2.5" />
          <circle className={styles.node} cx="304" cy="74" r="2" />
          <circle className={styles.node} cx="352" cy="190" r="2.5" />
          <circle className={styles.node} cx="320" cy="296" r="2" />
          <circle className={styles.node} cx="62" cy="294" r="2.5" />
          <circle className={styles.node} cx="72" cy="98" r="2" />
        </svg>

        <div className={styles.disc}>
          <LogoMark className={styles.emblem} />
        </div>

        {/* The five things the product does, arriving one at a time. Inline
            SVG rather than the five PNG and SVG files the mockup shipped:
            five fewer requests during the one second the page underneath is
            hydrating, and they inherit `currentColor`. */}
        <span className={clsx(styles.badge, styles.badge1)}>
          <BriefcaseGlyph />
        </span>
        <span className={clsx(styles.badge, styles.badge2)}>
          <BankGlyph />
        </span>
        <span className={clsx(styles.badge, styles.badge3)}>
          <BellGlyph />
        </span>
        <span className={clsx(styles.badge, styles.badge4)}>
          <DocumentGlyph />
        </span>
        <span className={clsx(styles.badge, styles.badge5)}>
          <CalendarGlyph />
        </span>
      </div>

      <div className={styles.brand}>
        <p className={styles.title}>
          JobsTrackr<span className={styles.titleDot}>.</span>
        </p>
        <p className={styles.tagline}>Find. Track. Succeed.</p>
        <p className={styles.blurb}>
          Your journey to the right
          <br />
          government job starts here.
        </p>
      </div>

      <div className={styles.dock}>
        <div className={styles.track}>
          <div className={styles.fill} />
        </div>
        {/* Four messages crossfading in one place. They are decoration, not a
            report: nothing here is waiting on a network call, so the copy says
            what the product does rather than claiming a stage it is at. */}
        <div className={styles.status}>
          <span>Loading opportunities…</span>
          <span>Connecting government portals…</span>
          <span>Syncing notifications…</span>
          <span>Welcome to JobsTrackr</span>
        </div>
      </div>
    </div>
  );
}

/* ── Badge glyphs ────────────────────────────────────────────────────────
   Drawn here rather than imported from `@/components/icons`: that set is the
   app's navigation weight and these sit at 28px inside a glowing disc, where
   a 1.6px stroke reads as spidery. */

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function BriefcaseGlyph() {
  return (
    <svg viewBox="0 0 24 24" {...STROKE}>
      <rect x="2.5" y="7.5" width="19" height="12.5" rx="2.5" />
      <path d="M8.5 7.5V5.8A1.8 1.8 0 0 1 10.3 4h3.4a1.8 1.8 0 0 1 1.8 1.8v1.7" />
      <path d="M2.5 12.5h19" />
    </svg>
  );
}

function BankGlyph() {
  return (
    <svg viewBox="0 0 24 24" {...STROKE}>
      <path d="M3 9.5 12 4l9 5.5" />
      <path d="M4.5 9.5v9M9.5 9.5v9M14.5 9.5v9M19.5 9.5v9" />
      <path d="M2.5 20h19" />
    </svg>
  );
}

function BellGlyph() {
  return (
    <svg viewBox="0 0 24 24" {...STROKE}>
      <path d="M18 8.5a6 6 0 1 0-12 0c0 6-2 7.5-2 7.5h16s-2-1.5-2-7.5Z" />
      <path d="M10.3 19.5a2 2 0 0 0 3.4 0" />
    </svg>
  );
}

function DocumentGlyph() {
  return (
    <svg viewBox="0 0 24 24" {...STROKE}>
      <path d="M14 2.5H7a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7.5Z" />
      <path d="M14 2.5v5h5" />
      <path d="M8.5 13h7M8.5 16.5h4.5" />
    </svg>
  );
}

function CalendarGlyph() {
  return (
    <svg viewBox="0 0 24 24" {...STROKE}>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <circle cx="8.5" cy="14.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="14.5" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}
