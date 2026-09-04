/**
 * The three pieces of brand artwork, as `<picture>` elements.
 *
 * ## Why not `next/image`
 *
 * Measured, not assumed. `next/image` on these two screens cost **+5.3 kB of
 * gzipped JavaScript** on `/sign-in`, `/sign-up`, `/forgot-password` and
 * `/reset-password`, and **+4.9 kB on `/`** — against a project budget whose
 * own notes record fighting over 2.4 kB. That is the client runtime for a
 * component whose entire job here is to pick a format and a width for a
 * decorative background that never changes.
 *
 * Both of those jobs are already done. The AVIF and JPEG variants in
 * `public/brand` are generated ahead of time, so `<picture>` picks the format
 * with `type` and the width with `srcset`/`sizes` — the same negotiation, in
 * markup the browser has understood for a decade, at zero bytes of script.
 *
 * The bytes are not a compromise either. Encoded once from the master rather
 * than at a generic runtime quality, the full-width artwork is 14.5 kB of AVIF
 * at 1920px and 5.6 kB at 768px; the emblem is 7.0 kB. Every fallback is a
 * JPEG or PNG for the browsers that predate AVIF, and nobody else fetches one.
 *
 * Three further things fall out of it, all of which matter on the free tier:
 * the files are ordinary static assets, so they are CDN-served with immutable
 * caching and never touch `/_next/image`; they consume none of Vercel's image
 * transformation quota; and there is no first-request optimisation latency for
 * the visitor who happens to arrive on a cold cache.
 *
 * ## Regenerating
 *
 * `scripts/build-brand-art.mjs` produces every file referenced below from the
 * masters. Run it if a master changes; nothing here is hand-edited.
 *
 * ## Alt text
 *
 * Empty on all three, deliberately. Two are abstract backgrounds and the third
 * is the mark beside a wordmark that already says "JobsTrackr" — announcing
 * any of them puts noise between a screen-reader user and the form. Where the
 * mark is the only content of a link, the link's own text carries the name.
 */

import { cn } from "@/lib/cn";

import styles from "./brand.module.css";

/** Fills its positioned parent. Used for both full-bleed backgrounds. */
const COVER = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
} as const;

/**
 * The credential screens' background: an abstract emerald sweep, full bleed.
 *
 * `fetchPriority="high"` and no `loading="lazy"`: it is the largest paint on
 * the route, and a hero the browser deprioritises is a hero that arrives after
 * the card has already been read.
 */
export function AuthArtwork({ className }: { className?: string | undefined }) {
  return (
    <picture>
      <source
        type="image/avif"
        srcSet="/brand/auth-bg-768.avif 768w, /brand/auth-bg-1280.avif 1280w, /brand/auth-bg-1920.avif 1920w"
        sizes="100vw"
      />
      <img
        src="/brand/auth-bg-1280.jpg"
        alt=""
        width={1920}
        height={1278}
        decoding="async"
        fetchPriority="high"
        className={className}
        style={COVER}
      />
    </picture>
  );
}

/** The splash's landscape band: ridge line, valley and the winding road. */
export function SplashRidge({ className }: { className?: string | undefined }) {
  return (
    <picture>
      <source
        type="image/avif"
        srcSet="/brand/splash-ridge-640.avif 640w, /brand/splash-ridge-946.avif 946w"
        sizes="100vw"
      />
      <img
        src="/brand/splash-ridge-946.jpg"
        alt=""
        width={946}
        height={902}
        decoding="async"
        fetchPriority="high"
        className={className}
        style={COVER}
      />
    </picture>
  );
}

/**
 * The white emblem, for the surfaces that are dark whatever the theme is —
 * today that is the splash's disc, which paints its own night sky.
 *
 * One size, because it is only ever drawn between 40px and 154px and the 540px
 * master covers every one of those at 3× — a second variant would be more
 * bytes in the repository and no fewer over the wire.
 *
 * Anywhere the background follows the theme, use `BrandMark` below instead: a
 * white mark on the paper ground is an invisible mark.
 */
export function LogoMark({ className }: { className?: string | undefined }) {
  return (
    <picture>
      <source type="image/avif" srcSet="/brand/logo-mark.avif" />
      <img
        src="/brand/logo-mark.png"
        alt=""
        width={540}
        height={583}
        decoding="async"
        fetchPriority="high"
        className={className}
      />
    </picture>
  );
}

/**
 * The same emblem, in whichever colour the current theme needs: navy on paper,
 * white on the dark ground. This is the one to reach for in the app chrome.
 *
 * A `<span>` painted with a background image, for the reason set out at the
 * top of `brand.module.css` — it is how the browser is made to fetch one of
 * the two files rather than both. Give it a width; the aspect ratio supplies
 * the height.
 *
 * `aria-hidden`, always. Every placement is a link or a heading that already
 * says "JobsTrackr" in text beside it, and a screen reader announcing the mark
 * as well would read the brand twice on every page of the site.
 */
export function BrandMark({ className }: { className?: string | undefined }) {
  return <span aria-hidden className={cn(styles.mark, className)} />;
}
