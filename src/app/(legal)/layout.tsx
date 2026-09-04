import type { ReactNode } from "react";

/**
 * The legal pages.
 *
 * Grouped so the three of them share one measure and one type treatment, and
 * so a fourth can be added without copying a wrapper. Fully static: nothing
 * here reads the database, the session, or the request.
 *
 * The type rules are hand-rolled rather than pulled from a typography plugin —
 * this is the only long-form prose in the app, and a dependency for three pages
 * would cost more than the rules below. `max-w-[68ch]` keeps the measure in the
 * readable band; these are documents people actually have to read.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[68ch] px-4 py-10 sm:px-6 lg:py-14">
      <article
        className={[
          "text-ink",
          "[&_h1]:font-cond [&_h1]:text-balance [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:tracking-tight",
          "[&_h2]:mt-10 [&_h2]:text-balance [&_h2]:text-lg [&_h2]:font-semibold",
          "[&_p]:mt-4 [&_p]:leading-relaxed [&_p]:text-ink-2",
          "[&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ul]:text-ink-2",
          "[&_li]:leading-relaxed [&_li]:marker:text-ink-3",
          "[&_a]:font-medium [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2",
          "[&_dl]:mt-4 [&_dl]:space-y-3 [&_dl]:text-ink-2",
          "[&_dt]:font-medium [&_dt]:text-ink",
          // `dd` has a 40px browser default indent that reads as an accident
          // next to the list indent above it, and `code` is only used for the
          // OAuth scope names in the privacy policy — three words that have to
          // be quoted exactly, so they are set apart rather than left to the
          // browser's unstyled monospace.
          "[&_dd]:ms-0 [&_dd]:mt-1 [&_dd]:leading-relaxed",
          "[&_code]:rounded [&_code]:bg-ink/[0.06] [&_code]:px-1 [&_code]:py-0.5",
          "[&_code]:font-mono [&_code]:text-[0.9em] [&_code]:text-ink",
        ].join(" ")}
      >
        {children}
      </article>
    </div>
  );
}
