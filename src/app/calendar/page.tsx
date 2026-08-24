import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { listDeadlinesInMonth, type CalendarEvent } from "@/lib/db/queries/calendar";
import { formatDate } from "@/lib/format/deadline";

export const metadata: Metadata = {
  title: "Exam calendar",
  description: "Every government job application deadline, month by month.",
  alternates: { canonical: "/calendar" },
};

type SearchParams = Promise<{ m?: string; d?: string }>;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export default function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 lg:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Exam calendar</h1>
      <p className="mt-1 text-sm text-ink-2">
        Application deadlines, month by month. Select a day to see what closes.
      </p>

      <Suspense fallback={<CalendarSkeleton />}>
        <Month searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Month({ searchParams }: { searchParams: SearchParams }) {
  const { m, d } = await searchParams;

  const { year, month } = parseMonth(m);
  const events = await listDeadlinesInMonth(year, month);

  // Grouped once, so each cell is a map lookup rather than a filter over the
  // whole month — 42 cells filtering 300 events is 12,600 comparisons for a
  // grid that could do 42.
  const byDate = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const list = byDate.get(event.date);
    if (list) list.push(event);
    else byDate.set(event.date, [event]);
  }

  const cells = monthCells(year, month);
  const selected = d && byDate.has(d) ? d : null;

  const prev = shiftMonth(year, month, -1);
  const next = shiftMonth(year, month, 1);

  return (
    <>
      <div className="mt-6 flex items-center justify-between gap-3">
        <MonthLink to={prev} label="Previous month">
          ←
        </MonthLink>

        <h2 className="text-base font-semibold text-ink tabular">{monthName(year, month)}</h2>

        <MonthLink to={next} label="Next month">
          →
        </MonthLink>
      </div>

      {/*
        The grid is `grid-cols-7` with every cell `min-w-0`, and that pairing is
        the whole fix. `grid-cols-7` alone still lets a long job title set the
        column's minimum width — grid items default to `min-width: auto` — so
        one row grows wider than the others and the month visibly stops lining
        up. `min-w-0` lets the cell shrink below its content, and `truncate`
        deals with the overflow. Seven equal columns at every width.
      */}
      <div
        role="grid"
        aria-label={`Deadlines in ${monthName(year, month)}`}
        className="mt-4 overflow-hidden rounded-lg border border-line"
      >
        <div role="row" className="grid grid-cols-7 border-b border-line bg-surface-2">
          {WEEKDAYS.map((day) => (
            <div
              key={day}
              role="columnheader"
              className="min-w-0 truncate px-1 py-2 text-center text-2xs font-medium tracking-wide text-ink-3 uppercase"
            >
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {cells.map((cell, i) => {
            const dayEvents = cell.date ? (byDate.get(cell.date) ?? []) : [];
            return (
              <DayCell
                key={cell.date ?? `blank-${String(i)}`}
                cell={cell}
                events={dayEvents}
                month={`${String(year)}-${pad(month)}`}
                isSelected={cell.date !== null && cell.date === selected}
              />
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-ink-3">
          {events.length === 0
            ? "Nothing closes this month."
            : `${String(events.length)} ${events.length === 1 ? "deadline" : "deadlines"} this month.`}
        </p>

        {events.length > 0 ? (
          <a
            href={`/calendar/ics?m=${String(year)}-${pad(month)}`}
            className="text-xs font-medium text-accent hover:underline"
          >
            Add to your calendar (.ics)
          </a>
        ) : null}
      </div>

      {selected ? <DaySheet date={selected} events={byDate.get(selected) ?? []} /> : null}
    </>
  );
}

/**
 * One day.
 *
 * A link rather than a button, so selecting a day is a URL — shareable,
 * back-button-able, and working with no JavaScript at all. The whole day sheet
 * is server-rendered for the same reason.
 */
function DayCell({
  cell,
  events,
  month,
  isSelected,
}: {
  cell: { date: string | null; day: number | null; isToday: boolean };
  events: CalendarEvent[];
  month: string;
  isSelected: boolean;
}) {
  if (cell.date === null) {
    // Padding for the days before the 1st and after the last. Rendered rather
    // than skipped so the seven-column rhythm never breaks.
    return (
      <div
        role="gridcell"
        aria-hidden
        className="min-h-16 min-w-0 border-b border-r border-line/60 bg-surface-2/40 last:border-r-0"
      />
    );
  }

  return (
    <Link
      role="gridcell"
      href={`/calendar?m=${month}&d=${cell.date}`}
      scroll={false}
      aria-current={cell.isToday ? "date" : undefined}
      aria-label={`${String(cell.day)} — ${String(events.length)} closing`}
      className={[
        "flex min-h-16 min-w-0 flex-col gap-0.5 border-b border-r border-line/60 p-1.5 last:border-r-0",
        "transition-colors duration-(--duration-fast) hover:bg-surface-2",
        isSelected ? "bg-accent/10 ring-1 ring-inset ring-accent/40" : "",
      ].join(" ")}
    >
      <span
        className={[
          "text-xs tabular",
          cell.isToday ? "font-semibold text-accent" : "text-ink-2",
        ].join(" ")}
      >
        {cell.day}
      </span>

      {events.length > 0 ? (
        // The count always, the word only where it fits. Truncating "7 close"
        // to "7 c…" on a phone spends the whole cell saying nothing — the
        // number is the information, and the verb is decoration.
        <span className="min-w-0 truncate rounded bg-critical-soft px-1 text-2xs font-medium text-critical">
          {events.length}
          <span className="hidden sm:inline">{events.length === 1 ? " closes" : " close"}</span>
        </span>
      ) : null}
    </Link>
  );
}

function DaySheet({ date, events }: { date: string; events: CalendarEvent[] }) {
  return (
    <section className="mt-6 rounded-lg border border-line bg-surface p-4">
      <h3 className="text-sm font-semibold text-ink">Closing {formatDate(date)}</h3>
      <ul className="mt-3 flex flex-col gap-2">
        {events.map((event) => (
          <li key={event.id}>
            <Link
              href={`/jobs/${event.slug}`}
              className="block rounded-md border border-line px-3 py-2 transition-colors hover:border-line-strong hover:bg-surface-2"
            >
              {event.organization ? (
                <span className="text-2xs font-medium tracking-wide text-ink-3 uppercase">
                  {event.organization}
                </span>
              ) : null}
              <span className="block text-sm font-medium text-ink">{event.title}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MonthLink({
  to,
  label,
  children,
}: {
  to: { year: number; month: number };
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={`/calendar?m=${String(to.year)}-${pad(to.month)}`}
      aria-label={label}
      className="inline-flex size-8 items-center justify-center rounded-md border border-line text-ink-2 transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-ink"
    >
      {children}
    </Link>
  );
}

/* ── Date helpers ───────────────────────────────────────────────────────── */
// All of these work in UTC parts. A local `Date` would resolve month
// boundaries in the server's zone, which is not the reader's, and the
// off-by-one it produces only shows up for people in negative offsets.

const pad = (n: number) => String(n).padStart(2, "0");

function parseMonth(value: string | undefined): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month >= 1 && month <= 12 && year >= 2000 && year <= 2100) {
      return { year, month };
    }
  }
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

function shiftMonth(year: number, month: number, by: number) {
  const zero = year * 12 + (month - 1) + by;
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
}

function monthName(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** 42 cells — six weeks — so the grid's height never changes between months. */
function monthCells(year: number, month: number) {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  // Monday-first: getUTCDay() is 0 for Sunday, so Sunday becomes 6.
  const leading = (firstOfMonth.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const today = new Date().toISOString().slice(0, 10);

  return Array.from({ length: 42 }, (_, i) => {
    const day = i - leading + 1;
    if (day < 1 || day > daysInMonth) {
      return { date: null, day: null, isToday: false };
    }
    const date = `${String(year)}-${pad(month)}-${pad(day)}`;
    return { date, day, isToday: date === today };
  });
}

function CalendarSkeleton() {
  return (
    <div className="mt-6">
      <Skeleton className="mx-auto h-8 w-40" />
      <Skeleton className="mt-4 h-96 w-full rounded-lg" />
    </div>
  );
}
