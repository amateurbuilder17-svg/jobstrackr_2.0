import type { ReactNode } from "react";

import { CalendarIcon, ClockIcon, ExternalLinkIcon } from "@/components/icons";
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
 * Designed with a premium editorial feel matching the reference screenshot:
 * - Brand accent vertical bar on every section title.
 * - Rounded-2xl cards with hairline borders and subtle elevation.
 * - Highlighted deadlines in critical red.
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

/**
 * Free-text prose from the notification, preserving line breaks.
 */
export function Prose({ text }: { text: string }) {
  return (
    <p className="leading-relaxed whitespace-pre-line text-sm sm:text-base text-ink-2">
      {decodeEntities(text)}
    </p>
  );
}

export function ImportantDates({ value }: { value: Json | null }) {
  const dates = toImportantDates(value);
  if (dates.length === 0) return null;

  return (
    <Section title="Important dates">
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
        <dl className="divide-y divide-line">
          {dates.map((entry) => {
            const isClosing = /last[\s-]?date|closing|apply[\s-]?end|deadline/i.test(entry.event);
            const Icon = isClosing ? ClockIcon : CalendarIcon;

            return (
              <div
                key={`${entry.event}-${entry.date}`}
                className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
              >
                <dt className="flex min-w-0 items-center gap-2.5 text-ink">
                  <Icon className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
                  <span className="truncate">{entry.event}</span>
                </dt>
                <dd
                  className={`tabular shrink-0 text-right text-sm ${
                    isClosing ? "font-semibold text-critical" : "font-medium text-ink"
                  }`}
                >
                  {entry.date}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
    </Section>
  );
}

export function VacancyBreakdown({ value }: { value: Json | null }) {
  const table = toVacancyTable(value);
  if (!table) return null;

  return (
    <Section title="Vacancy breakdown">
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-xs">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2/70">
              {table.columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="cond px-4 py-3 text-left text-xs font-semibold whitespace-nowrap text-ink-2"
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {table.rows.map((row, i) => (
              <tr key={i} className="transition-colors hover:bg-surface-2/40">
                {row.map((cell, j) => (
                  <td key={j} className="tabular px-4 py-3 whitespace-nowrap text-ink">
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
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
        <dl className="divide-y divide-line">
          {fees.map((fee) => (
            <div
              key={fee.category}
              className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
            >
              <dt className="min-w-0 text-ink-2">{fee.category}</dt>
              <dd className="tabular shrink-0 font-semibold text-ink">{fee.fee}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}

export function SelectionProcess({ value }: { value: Json | null }) {
  const steps = toSteps(value);
  if (steps.length === 0) return null;

  return (
    <Section title="Selection process">
      <ol className="ml-5 list-decimal space-y-2 text-ink-2 marker:font-semibold marker:text-ink-3">
        {steps.map((step) => (
          <li key={step} className="pl-1 text-sm leading-relaxed">
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
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
        <dl className="divide-y divide-line">
          {entries.map((entry) => (
            <div
              key={entry.label}
              className="flex items-center justify-between gap-4 px-4 py-3 text-sm"
            >
              <dt className="w-40 shrink-0 text-ink-3">{entry.label}</dt>
              <dd className="min-w-0 text-right font-medium text-ink">{entry.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}

export interface QuickLink {
  label: string;
  url: string;
  category?: string;
}

export function QuickLinks({ links }: { links: QuickLink[] }) {
  if (links.length === 0) return null;

  return (
    <Section title="Documents and links">
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
        <ul className="divide-y divide-line">
          {links.map((link) => (
            <li key={link.url}>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="flex items-center gap-3 px-4 py-3.5 text-sm transition-colors duration-(--duration-fast) hover:bg-surface-2"
              >
                {link.category ? <Badge className="shrink-0">{link.category}</Badge> : null}
                <span className="min-w-0 flex-1 truncate font-medium text-ink">{link.label}</span>
                <ExternalLinkIcon className="size-4 shrink-0 text-ink-3" />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}
