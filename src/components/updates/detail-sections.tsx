import type { ReactNode } from "react";

import { CalendarIcon, ClockIcon, ExternalLinkIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import type {
  UpdateDate,
  UpdateLink,
  UpdateOverviewRow,
  UpdateSection,
} from "@/lib/updates/detail-shape";

/**
 * The body of an exam update page, matching the Gazette design system:
 * - Brand accent vertical bar on every section title.
 * - Rounded-2xl cards with hairline borders and subtle elevation.
 * - Highlighted deadlines in semantic tones.
 */

export function Section({
  title,
  children,
  id,
}: {
  title: string;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="mt-8" id={id}>
      <div className="mb-3 flex items-center gap-2.5">
        <span className="h-4.5 w-1 shrink-0 rounded-full bg-brand" aria-hidden="true" />
        <h2 className="text-base sm:text-lg font-bold tracking-tight text-ink">{title}</h2>
      </div>
      <div>{children}</div>
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
 * The scraped date table with rounded-2xl cards and clear status indicators.
 */
export function ImportantDates({ dates }: { dates: UpdateDate[] }) {
  if (dates.length === 0) return null;

  return (
    <Section title="Important dates">
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
        <dl className="divide-y divide-line">
          {dates.map((entry, i) => {
            const isClosing = /clos|last[\s-]?date|deadline|end/i.test(entry.event);
            const Icon = isClosing ? ClockIcon : CalendarIcon;

            return (
              <div
                key={`${entry.event}-${entry.date}-${String(i)}`}
                className="px-4 py-3 sm:px-5"
              >
                <div className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] sm:items-center">
                  <dt className="flex min-w-0 items-center gap-2 text-ink break-words">
                    <Icon className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
                    <span>{entry.event}</span>
                  </dt>
                  <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:justify-end">
                    {entry.status ? (
                      <Badge tone={statusTone(entry.status)}>{entry.status}</Badge>
                    ) : null}
                    <span
                      className={cn(
                        "tabular min-w-0 break-words sm:text-right",
                        isClosing ? "font-semibold text-critical" : "font-medium text-ink",
                      )}
                    >
                      {entry.date}
                    </span>
                    {entry.link ? (
                      <a
                        href={entry.link}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="inline-flex shrink-0 items-center gap-0.5 text-accent hover:underline"
                        aria-label={`Open link for ${entry.event}`}
                      >
                        <ExternalLinkIcon className="size-3.5" />
                      </a>
                    ) : null}
                  </dd>
                </div>
                {entry.note ? (
                  <p className="mt-1.5 pl-6 break-words text-xs leading-snug text-ink-3">
                    {entry.note}
                  </p>
                ) : null}
              </div>
            );
          })}
        </dl>
      </div>
    </Section>
  );
}

export function Overview({ rows }: { rows: UpdateOverviewRow[] }) {
  if (rows.length === 0) return null;

  return (
    <Section title="At a glance">
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
        <dl className="divide-y divide-line">
          {rows.map((row, i) => (
            <div
              key={`${row.field}-${String(i)}`}
              className="flex items-center justify-between gap-4 px-4 py-3 sm:px-5 text-sm"
            >
              <dt className="w-2/5 sm:w-1/3 shrink-0 font-medium text-ink-3">{row.field}</dt>
              <dd className="min-w-0 break-words font-medium text-ink text-right sm:text-left">
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}

/**
 * The article, one collapsible panel per heading.
 * Native `<details>` in rounded-2xl cards.
 */
export function Details({ sections }: { sections: UpdateSection[] }) {
  if (sections.length === 0) return null;

  return (
    <Section title="Details">
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-xs divide-y divide-line">
        {sections.map((section, i) => (
          <details key={`${section.heading}-${String(i)}`} open={i === 0} className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 sm:px-5 text-sm font-semibold text-ink transition-colors duration-(--duration-fast) hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
              <span className="min-w-0">{section.heading || "More detail"}</span>
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
            <div className="border-t border-line bg-surface-2/40 px-4 py-3.5 sm:px-5">
              <ul className="flex flex-col gap-2 text-sm leading-relaxed text-ink-2">
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
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
        <ul className="divide-y divide-line">
          {links.map((link) => (
            <li key={link.url}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="flex items-center gap-3 px-4 py-3.5 sm:px-5 text-sm font-medium text-ink transition-colors duration-(--duration-fast) hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1 truncate">{link.label}</span>
                <ExternalLinkIcon className="size-4 shrink-0 text-ink-3" />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
