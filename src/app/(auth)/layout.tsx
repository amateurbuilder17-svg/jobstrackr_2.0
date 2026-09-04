import Link from "next/link";
import type { ReactNode } from "react";

import { AuthArtwork, BrandMark } from "@/components/brand/artwork";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { AuthDarkDefault } from "./auth-theme";
import styles from "./auth.module.css";

/**
 * The frame the four credential screens share.
 *
 * `data-fullbleed` is the whole of the takeover: `globals.css` hides the app
 * chrome wherever that attribute appears, so this layout owns the viewport
 * without the root layout needing to know which route is rendering. See the
 * "Full-bleed routes" block there for why it is done from this end.
 *
 * A Server Component with no state. The only JavaScript any of these screens
 * ships is the theme toggle — which the shell already carried on every route,
 * so it is not new — the one-effect `AuthDarkDefault`, the password reveal,
 * and the submit buttons' pending state. The artwork, the glass, the tabs and
 * the corner flares are CSS.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div data-fullbleed className={styles.viewport}>
      <AuthDarkDefault />
      <div className={styles.art}>
        <AuthArtwork className={styles.artImage} />
      </div>
      <div className={styles.ambience} aria-hidden />

      <div className={styles.themeSlot}>
        <ThemeToggle />
      </div>

      <section className={styles.editorial}>
        <Link href="/" className={styles.brandLink}>
          <BrandMark className={styles.brandMark} />
          <span className={styles.brandWord}>
            JobsTrackr<span className={styles.dot}>.</span>
          </span>
        </Link>

        <div className={styles.editorialBody}>
          <div className={styles.pill}>
            <span className={styles.pillDot} />
            <span className={styles.pillText}>Government career intelligence</span>
          </div>

          {/* A paragraph, not a heading. It reads like one, but the page's
              heading is the card's "Welcome back" — and this column comes
              first in the DOM, so marking it up as an `<h2>` would put a
              level-two heading above the level-one on every credential screen
              and hand a screen-reader user the marketing copy as the page's
              structure. It is decoration; the form is the page. */}
          <p className={styles.headline}>
            Your next opportunity
            <br />
            <span className={styles.headlineAccent}>starts here.</span>
          </p>

          <p className={styles.sub}>
            Track government jobs, exams and important updates — all in one place.
          </p>

          <div className={styles.rule} />

          {/*
            Three claims the product can actually stand behind. The mockup's
            "2,800+ Active Notifications" was a number from a design file; this
            one says what the corpus is without asserting a count that would be
            wrong the day ingestion runs.
          */}
          <div className={styles.metrics}>
            <div className={styles.metric}>
              <span className={styles.metricValue}>Daily</span>
              <span className={styles.metricLabel}>Notification sync</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricValue}>100%</span>
              <span className={styles.metricLabel}>Official sources</span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricValue}>Zero</span>
              <span className={styles.metricLabel}>Spam or clutter</span>
            </div>
          </div>
        </div>
      </section>

      <div className={styles.formPane}>
        <div className={styles.card}>
          {/* Below 900px the editorial column is gone, so the card carries the
              brand instead. Hidden with `display: none` above that width
              rather than duplicated conditionally — the markup is four
              elements, and a media query cannot be wrong about the viewport
              the way a server-side guess can. */}
          <Link href="/" className={styles.cardBrand}>
            <BrandMark className={styles.cardBrandMark} />
            <span className={styles.cardBrandWord}>
              JobsTrackr<span className={styles.dot}>.</span>
            </span>
          </Link>

          {children}
        </div>
      </div>
    </div>
  );
}
