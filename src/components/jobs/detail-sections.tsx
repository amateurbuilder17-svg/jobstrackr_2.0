import type { ReactNode } from "react";

import { ExternalLinkIcon } from "@/components/icons";
import { Badge } from "@/components/ui/badge";
import type { Json } from "@/lib/db/database.types";
import { decodeEntities } from "@/lib/format/text";
import {
  toFeeRows,
  toImportantDates,
  toOverview,
  toSteps,
  toVacancyTable,
} from "@/lib/jobs/detail-shape";

/**
 * The body of a job page.
 *
 * Every component here is a Server Component with no state, so the whole of it
 * — nine sections, a scrolling table and a fee list — costs the browser
 * nothing beyond the HTML. The old page rendered the same content through
 * client React with `lucide-react` attached, which is 55 kB before a single
 * date is drawn.
 *
 * Each section renders nothing at all when its column is empty, rather than a
 * heading over an empty box. A job page for a thin notification should look
 * short, not broken.
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
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * Free-text prose from the notification, preserving its own line breaks.
 *
 * Decoded here as well as at ingest. React escapes what it renders, so a
 * description still carrying `&ndash;` from the page it was scraped off prints
 * those seven characters in the middle of a sentence — which is what 92
 * production rows do today. Ingest decodes what it writes from now on; this
 * decodes what is already stored, and decoding twice is a no-op.
 */
export function Prose({ text }: { text: string }) {
  return (
    <p className="leading-relaxed whitespace-pre-line text-ink-2">{decodeEntities(text)}</p>
  );
}

export function ImportantDates({ value }: { value: Json | null }) {
  const dates = toImportantDates(value);
  if (dates.length === 0) return null;

  return (
    <Section title="Important dates">
      <dl className="overflow-hidden rounded-lg border border-line bg-surface">
        {dates.map((entry) => (
          <div
            key={`${entry.event}-${entry.date}`}
            className="flex gap-4 border-b border-line px-4 py-2.5 text-sm last:border-b-0"
          >
            <dt className="min-w-0 flex-1 text-ink-2">{entry.event}</dt>
            <dd className="tabular shrink-0 font-medium text-ink">{entry.date}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

export function VacancyBreakdown({ value }: { value: Json | null }) {
  const table = toVacancyTable(value);
  if (!table) return null;

  return (
    <Section title="Vacancy breakdown">
      {/* The scroll container is this div and nothing above it. A wide table
          that scrolls the page body sideways is both a GIGW failure and the
          single thing that makes a layout feel broken on a phone. */}
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2">
              {table.columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="cond px-3 py-2 text-left text-xs font-semibold whitespace-nowrap text-ink-2"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, i) => (
              <tr key={i} className="border-b border-line bg-surface last:border-b-0">
                {row.map((cell, j) => (
                  <td key={j} className="tabular px-3 py-2 whitespace-nowrap text-ink">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export function ApplicationFees({ value }: { value: Json | null }) {
  const fees = toFeeRows(value);
  if (fees.length === 0) return null;

  return (
    <Section title="Application fee">
      <dl className="overflow-hidden rounded-lg border border-line bg-surface">
        {fees.map((fee) => (
          <div
            key={fee.category}
            className="flex gap-4 border-b border-line px-4 py-2.5 text-sm last:border-b-0"
          >
            <dt className="min-w-0 flex-1 text-ink-2">{fee.category}</dt>
            <dd className="tabular shrink-0 font-medium text-ink">{fee.fee}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

export function SelectionProcess({ value }: { value: Json | null }) {
  const steps = toSteps(value);
  if (steps.length === 0) return null;

  return (
    <Section title="Selection process">
      {/* A real ordered list. The old page drew a numbered circle per step with
          a span and a flex row, which is a list reimplemented in markup that
          says nothing — a screen reader heard eight paragraphs, not "1 of 8". */}
      <ol className="ml-5 list-decimal space-y-1.5 text-ink-2 marker:font-semibold marker:text-ink-3">
        {steps.map((step) => (
          <li key={step} className="pl-1">
            {step}
          </li>
        ))}
      </ol>
    </Section>
  );
}

export function Overview({ value }: { value: Json | null }) {
  const entries = toOverview(value);
  if (entries.length === 0) return null;

  return (
    <Section title="At a glance">
      <dl className="overflow-hidden rounded-lg border border-line bg-surface">
        {entries.map((entry) => (
          <div
            key={entry.label}
            className="flex gap-4 border-b border-line px-4 py-2.5 text-sm last:border-b-0"
          >
            <dt className="w-40 shrink-0 text-ink-3">{entry.label}</dt>
            <dd className="min-w-0 text-ink">{entry.value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

export interface QuickLink {
  label: string;
  url: string;
  category?: string;
}

/**
 * Documents and official links.
 *
 * Every URL here was normalised and blocklisted at ingest, so this renders
 * whatever it is given. The old page carried the blocklist in this component
 * and re-applied it on every render, which is how an aggregator link that
 * slipped through a gap stayed visible until the list was patched.
 */
export function QuickLinks({ links }: { links: QuickLink[] }) {
  if (links.length === 0) return null;

  return (
    <Section title="Documents and links">
      <ul className="overflow-hidden rounded-lg border border-line bg-surface">
        {links.map((link) => (
          <li key={link.url} className="border-b border-line last:border-b-0">
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="flex items-center gap-3 px-4 py-3 text-sm transition-colors duration-(--duration-fast) hover:bg-surface-2"
            >
              {link.category ? <Badge className="shrink-0">{link.category}</Badge> : null}
              <span className="min-w-0 flex-1 truncate text-ink">{link.label}</span>
              <ExternalLinkIcon className="size-4 shrink-0 text-ink-3" />
            </a>
          </li>
        ))}
      </ul>
    </Section>
  );
}
