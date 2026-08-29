import type { ReactNode } from "react";

/**
 * Help, FAQ, the user manual and the feedback form.
 *
 * The same measure and type treatment as the legal group, and deliberately a
 * second group rather than a fourth page in that one: these are documents
 * people read to get something done, the legal pages are documents people read
 * because they have to, and the two sets change for entirely different reasons.
 *
 * Fully static. Nothing here reads the database, the session or the request —
 * the feedback form's action is a POST, which does not make the page holding it
 * dynamic.
 */
export default function SupportLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[68ch] px-4 py-10 sm:px-6 lg:py-14">
      <article
        className={[
          "text-ink",
          "[&_h1]:font-cond [&_h1]:text-balance [&_h1]:text-3xl [&_h1]:font-bold [&_h1]:tracking-tight",
          "[&_h2]:mt-10 [&_h2]:text-balance [&_h2]:text-lg [&_h2]:font-semibold",
          "[&_h3]:mt-6 [&_h3]:text-balance [&_h3]:text-base [&_h3]:font-semibold",
          "[&_p]:mt-4 [&_p]:leading-relaxed [&_p]:text-ink-2",
          "[&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_ul]:text-ink-2",
          "[&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_ol]:text-ink-2",
          "[&_li]:leading-relaxed [&_li]:marker:text-ink-3",
          "[&_a]:font-medium [&_a]:text-accent [&_a]:underline [&_a]:underline-offset-2",
          "[&_dl]:mt-4 [&_dl]:space-y-3 [&_dl]:text-ink-2",
          "[&_dt]:font-medium [&_dt]:text-ink",
        ].join(" ")}
      >
        {children}
      </article>
    </div>
  );
}
