import { ExternalLinkIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import type {
  UpdateDate,
  UpdateLink,
  UpdateOverviewRow,
  UpdateSection,
} from "@/lib/updates/detail-shape";

/**
 * The body of an exam update page, in the old app's running order: dates, then
 * the overview table, then the article itself, then the links.
 *
 * That order is not arbitrary. Someone opening an admit-card update wants the
 * download window and the download button; the prose explaining how to log in
 * is what they read only if those did not answer the question. The old page put
 * the article last for that reason and this keeps it there.
 *
 * Every component is a Server Component with no state — the accordion below is
 * a native `<details>` — so the whole page costs the browser nothing beyond its
 * HTML. The old one drew the same content through client React with
 * `framer-motion` and `lucide-react` attached.
 *
 * Each section renders nothing when its data is empty, rather than a heading
 * over an empty box. A thin update should look short, not broken.
 */

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** Green for a window that is open, red for one that has closed. */
function statusTone(status: string): "good" | "critical" | "neutral" {
  if (/declar|out|released|available|active|start|open|live/i.test(status)) return "good";
  if (/clos|over|expir|end|last/i.test(status)) return "critical";
  return "neutral";
}

/**
 * The scraped date table.
 *
 * Both columns are `fr` tracks with a zero minimum, so neither can be squeezed
 * out by the other however long the scraped text runs. The old app's first
 * attempt gave the date column `flex-shrink-0 whitespace-nowrap`, and a
 * sentence-length date — they are common — collapsed the event column until the
 * label wrapped one letter per line. Below `sm` the cells stack instead.
 */
export function ImportantDates({ dates }: { dates: UpdateDate[] }) {
  if (dates.length === 0) return null;

  return (
    <Section title="Important dates">
      <dl className="overflow-hidden rounded-lg border border-line bg-surface">
        {dates.map((entry, i) => (
          <div
            key={`${entry.event}-${entry.date}-${String(i)}`}
            className="border-b border-line px-4 py-2.5 last:border-b-0"
          >
            <div className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] sm:items-baseline">
              <dt className="min-w-0 break-words text-ink-2">{entry.event}</dt>
              <dd className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1 sm:justify-end">
                {entry.status ? (
                  <Badge tone={statusTone(entry.status)}>{entry.status}</Badge>
                ) : null}
                <span className="tabular min-w-0 break-words font-medium text-ink sm:text-right">
                  {entry.date}
                </span>
                {entry.link ? (
                  <a
                    href={entry.link}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="shrink-0 text-accent hover:underline"
                    aria-label={`Open link for ${entry.event}`}
                  >
                    <ExternalLinkIcon className="size-3.5" />
                  </a>
                ) : null}
              </dd>
            </div>
            {entry.note ? (
              <p className="mt-1 break-words text-xs leading-snug text-ink-3">{entry.note}</p>
            ) : null}
          </div>
        ))}
      </dl>
    </Section>
  );
}

export function Overview({ rows }: { rows: UpdateOverviewRow[] }) {
  if (rows.length === 0) return null;

  return (
    <Section title="At a glance">
      <dl className="overflow-hidden rounded-lg border border-line bg-surface">
        {rows.map((row, i) => (
          <div
            key={`${row.field}-${String(i)}`}
            className="flex gap-4 border-b border-line px-4 py-2.5 text-sm last:border-b-0"
          >
            <dt className="w-2/5 shrink-0 text-ink-3">{row.field}</dt>
            <dd className="min-w-0 break-words text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

/**
 * The article, one collapsible panel per heading.
 *
 * `<details>` rather than a state hook: it opens without JavaScript, it is
 * findable by the browser's own in-page search even while closed, and it keeps
 * this route free of client components. The first panel is open so the page
 * never looks empty on arrival — the same default the old accordion used.
 */
export function Details({ sections }: { sections: UpdateSection[] }) {
  if (sections.length === 0) return null;

  return (
    <Section title="Details">
      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {sections.map((section, i) => (
          <details
            key={`${section.heading}-${String(i)}`}
            open={i === 0}
            className="group border-b border-line last:border-b-0"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-ink transition-colors duration-(--duration-fast) hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0">{section.heading || "More detail"}</span>
              {/* Rotates with the panel. `aria-hidden` because the disclosure
                  state is already announced by <details> itself. */}
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="size-4 shrink-0 text-ink-3 transition-transform duration-(--duration-fast) group-open:rotate-180"
              >
                <path d="m6 9 6 6 6-6" />
              </svg>
            </summary>
            <div className="border-t border-line bg-surface-2/40 px-4 py-3">
              <ul className="flex flex-col gap-1.5 text-sm leading-relaxed text-ink-2">
                {section.lines.map((line, li) => (
                  <li key={li}>{line}</li>
                ))}
              </ul>
            </div>
          </details>
        ))}
      </div>
    </Section>
  );
}

export function LinkList({ title, links }: { title: string; links: UpdateLink[] }) {
  if (links.length === 0) return null;

  return (
    <Section title={title}>
      <ul className="overflow-hidden rounded-lg border border-line bg-surface">
        {links.map((link) => (
          <li key={link.url} className="border-b border-line last:border-b-0">
            <a
              href={link.url}
              // Untrusted scraped destinations: noopener stops the target
              // reaching back through window.opener, noreferrer withholds this
              // site's URL from whoever is on the other end.
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="flex items-center gap-3 px-4 py-3 text-sm transition-colors duration-(--duration-fast) hover:bg-surface-2"
            >
              <span className="min-w-0 flex-1 truncate text-ink">{link.label}</span>
              <ExternalLinkIcon className="size-4 shrink-0 text-ink-3" />
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}
