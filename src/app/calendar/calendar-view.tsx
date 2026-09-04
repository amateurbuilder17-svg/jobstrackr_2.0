"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { ChevronRightIcon } from "@/components/icons";
import { useToday } from "@/components/jobs/today-provider";
import type { CalendarEventType, PersonalEvent } from "@/lib/db/queries/calendar";
import { daysUntilFrom, formatDate } from "@/lib/format/deadline";
import { EVENT_DOT, EVENT_META, EVENT_ORDER } from "./event-meta";

/**
 * The curated calendar.
 *
 * ## Why the whole timeline arrives at once
 *
 * The month is client state, not a URL parameter, and that is a deliberate
 * reversal of what this page used to do. Paging months over the network made
 * sense when the answer was "every deadline in March" — an unbounded set that
 * had to be windowed to be affordable. It makes none now: one person's saved
 * and tracked exams is a few dozen dates in total, and fetching *all* of them
 * once costs less than fetching one month did. So ‹ and › are instant, and
 * flicking through a year touches the network zero times.
 *
 * ## Why a day is not a link
 *
 * The old grid made every cell a `<Link>` so a selected day was shareable. A
 * personal calendar has nobody to share a day with — the URL would resolve to a
 * different set of exams for whoever opened it. Selection is local state, and
 * the round trip it used to cost is gone with it.
 */
export function CalendarView({
  events,
  today: serverToday,
}: {
  events: PersonalEvent[];
  /** Today in India as the server saw it; the provider takes over on hydration. */
  today: string;
}) {
  const clientToday = useToday();
  const today = clientToday ?? serverToday;

  // The month in view. Starts on today's month rather than on the earliest
  // event: someone opening a calendar is asking about now.
  const [cursor, setCursor] = useState(() => monthOf(today));
  const [selected, setSelected] = useState<string | null>(null);

  const byDate = useMemo(() => {
    const map = new Map<string, PersonalEvent[]>();
    for (const event of events) {
      const list = map.get(event.date);
      if (list) list.push(event);
      else map.set(event.date, [event]);
    }
    // Within a day, lifecycle order — a closing before a result, always.
    for (const list of map.values()) {
      list.sort((a, b) => EVENT_META[a.type].order - EVENT_META[b.type].order);
    }
    return map;
  }, [events]);

  const groups = useMemo(() => groupBySubject(events, today), [events, today]);

  const urgent = groups.filter((g) => g.daysToNext !== null && g.daysToNext <= 7);
  const upcoming = groups.filter((g) => g.daysToNext !== null && g.daysToNext > 7);

  const cells = useMemo(() => monthCells(cursor.year, cursor.month, today), [cursor, today]);

  const monthCount = useMemo(
    () => events.filter((e) => e.date.startsWith(monthKey(cursor))).length,
    [events, cursor],
  );

  const move = (by: number) => {
    setCursor((c) => shiftMonth(c, by));
    // A day selected in March means nothing once April is on screen.
    setSelected(null);
  };

  const selectedEvents = selected ? (byDate.get(selected) ?? []) : [];

  return (
    <>
      <header className="flex items-start justify-between gap-4 pb-5">
        <div className="min-w-0">
          <p className="section-label cond">Your exam planner</p>
          <h1 className="mt-1.5 truncate text-3xl font-extrabold tracking-tight text-ink">
            {monthName(cursor.year, cursor.month)}
          </h1>
        </div>
        <div className="shrink-0 text-right">
          <p className="section-label cond">Today</p>
          <p className="mt-1.5 text-sm font-semibold text-accent tabular">{shortDate(today)}</p>
        </div>
      </header>

      {/* Month grid */}
      <div className="rounded-2xl border border-line bg-surface p-3.5 shadow-card sm:p-4">
        <div className="mb-3 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
          <MonthButton
            label={`Show ${monthName(...shiftTuple(cursor, -1))}`}
            onClick={() => {
              move(-1);
            }}
            direction="prev"
          />
          <p className="truncate text-center text-xs text-ink-3 tabular">
            {monthCount === 0
              ? "Nothing this month"
              : `${String(monthCount)} ${monthCount === 1 ? "date" : "dates"} this month`}
          </p>
          <MonthButton
            label={`Show ${monthName(...shiftTuple(cursor, 1))}`}
            onClick={() => {
              move(1);
            }}
            direction="next"
          />
        </div>

        <div
          role="grid"
          aria-label={`Your dates in ${monthName(cursor.year, cursor.month)}`}
          className="select-none"
        >
          <div role="row" className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((day) => (
              <div
                key={day.key}
                role="columnheader"
                aria-label={day.full}
                className="cond min-w-0 truncate py-1 text-center text-2xs font-bold tracking-[0.08em] text-ink-3 uppercase"
              >
                {day.short}
              </div>
            ))}
          </div>

          <div className="mt-0.5 grid grid-cols-7 gap-1">
            {cells.map((cell, i) => (
              <DayCell
                key={cell.date ?? `pad-${String(i)}`}
                cell={cell}
                events={cell.date ? (byDate.get(cell.date) ?? []) : []}
                isSelected={cell.date !== null && cell.date === selected}
                onSelect={setSelected}
              />
            ))}
          </div>
        </div>
      </div>

      <Legend />

      {selected ? (
        <DaySheet
          date={selected}
          events={selectedEvents}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}

      {groups.length === 0 ? (
        <EmptyCalendar />
      ) : (
        <>
          {urgent.length > 0 ? (
            <section className="mt-7">
              <p className="section-label cond text-ev-close">Urgent · next 7 days</p>
              <div className="mt-2.5 flex flex-col gap-2.5">
                {urgent.map((group) => (
                  <SubjectCard key={group.key} group={group} today={today} />
                ))}
              </div>
            </section>
          ) : null}

          {upcoming.length > 0 ? (
            <section className="mt-7">
              <p className="section-label cond">Upcoming</p>
              <div className="mt-2.5 flex flex-col gap-2.5">
                {upcoming.map((group) => (
                  <SubjectCard key={group.key} group={group} today={today} />
                ))}
              </div>
            </section>
          ) : null}

          {urgent.length === 0 && upcoming.length === 0 ? (
            <p className="mt-7 rounded-2xl border border-line bg-surface p-4 text-sm text-ink-2">
              Nothing ahead. Every date on the exams you follow has passed — use ‹ to look back
              over them.
            </p>
          ) : null}
        </>
      )}
    </>
  );
}

/* ── The grid ───────────────────────────────────────────────────────────── */

interface Cell {
  date: string | null;
  day: number | null;
  isToday: boolean;
}

function DayCell({
  cell,
  events,
  isSelected,
  onSelect,
}: {
  cell: Cell;
  events: PersonalEvent[];
  isSelected: boolean;
  onSelect: (date: string | null) => void;
}) {
  if (cell.date === null) {
    // Padding before the 1st and after the last, rendered rather than skipped
    // so the seven-column rhythm never breaks between months.
    return <div aria-hidden className="h-11 rounded-lg" />;
  }

  const date = cell.date;
  const hasEvents = events.length > 0;

  // At most three dots. A fourth would shrink all of them below the point of
  // being a colour, and the day sheet below is what actually enumerates a busy
  // day — the grid's job is to say "something happens here".
  const dots = dedupeTypes(events).slice(0, 3);

  const label = hasEvents
    ? `${String(cell.day)} — ${events.map((e) => `${EVENT_META[e.type].label}, ${e.subject}`).join("; ")}`
    : String(cell.day);

  return (
    <button
      type="button"
      role="gridcell"
      aria-label={label}
      // `aria-selected`, not `aria-pressed`: a gridcell is selected, not
      // toggled, and a screen reader announces the two differently.
      aria-selected={isSelected}
      aria-current={cell.isToday ? "date" : undefined}
      disabled={!hasEvents}
      onClick={() => {
        onSelect(isSelected ? null : date);
      }}
      className={[
        "flex h-11 flex-col items-center justify-center gap-1 rounded-lg",
        "transition-colors duration-(--duration-fast)",
        hasEvents ? "cursor-pointer hover:bg-surface-2" : "cursor-default",
        isSelected ? "bg-surface-3 ring-1 ring-line-strong ring-inset" : "",
        cell.isToday && !isSelected ? "today-pulse bg-accent" : "",
      ].join(" ")}
    >
      <span
        className={[
          "text-xs leading-none tabular",
          cell.isToday && !isSelected
            ? "font-bold text-on-accent"
            : hasEvents
              ? "font-semibold text-ink"
              : "text-ink-3",
        ].join(" ")}
      >
        {cell.day}
      </span>

      {/* Reserved whether or not there are dots, so a day with events is not a
          pixel taller than a day without and the rows never jitter. */}
      <span className="flex h-1.5 items-center gap-0.5" aria-hidden>
        {dots.map((type) => (
          <span
            key={type}
            className={[
              "size-1.5 rounded-full",
              EVENT_DOT[type],
              // On the filled today cell the dots sit on the accent, where the
              // accent-coloured one would vanish. A ring separates them.
              cell.isToday && !isSelected ? "ring-1 ring-on-accent/70" : "",
            ].join(" ")}
          />
        ))}
      </span>
    </button>
  );
}

function MonthButton({
  label,
  onClick,
  direction,
}: {
  label: string;
  onClick: () => void;
  direction: "prev" | "next";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="grid size-8 place-items-center rounded-lg border border-line text-ink-2 transition-colors duration-(--duration-fast) hover:border-line-strong hover:bg-surface-2 hover:text-ink active:scale-95"
    >
      <ChevronRightIcon
        className={`size-4 ${direction === "prev" ? "rotate-180" : ""}`}
        aria-hidden="true"
      />
    </button>
  );
}

function Legend() {
  return (
    <ul className="mt-3.5 flex flex-wrap gap-x-3.5 gap-y-1.5">
      {EVENT_ORDER.map((type) => (
        <li key={type} className="inline-flex items-center gap-1.5 text-2xs text-ink-2">
          <span className={`size-2 shrink-0 rounded-full ${EVENT_DOT[type]}`} aria-hidden />
          {EVENT_META[type].label}
        </li>
      ))}
    </ul>
  );
}

/* ── The day sheet ──────────────────────────────────────────────────────── */

function DaySheet({
  date,
  events,
  onClose,
}: {
  date: string;
  events: PersonalEvent[];
  onClose: () => void;
}) {
  return (
    <section className="mt-4 rounded-2xl border border-line bg-surface p-4 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-bold text-ink tabular">{formatDate(date)}</h2>
        <button
          type="button"
          onClick={onClose}
          className="cond -mt-0.5 shrink-0 text-2xs font-bold tracking-[0.08em] text-ink-3 uppercase transition-colors hover:text-ink"
        >
          Close
        </button>
      </div>

      <ul className="mt-3 flex flex-col gap-2">
        {events.map((event) => (
          <li key={event.id}>
            <EventRow event={event} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function EventRow({ event }: { event: PersonalEvent }) {
  const meta = EVENT_META[event.type];

  const body = (
    <>
      <span
        className={`mt-1.5 size-2 shrink-0 rounded-full ${EVENT_DOT[event.type]}`}
        aria-hidden
      />
      <span className="min-w-0">
        <span className={`block text-xs font-bold ${meta.fg}`}>
          {meta.label}
          {event.phase ? ` · ${event.phase}` : ""}
          {event.predicted ? <PredictedMark /> : null}
        </span>
        <span className="mt-0.5 block truncate text-sm font-medium text-ink">
          {event.subject}
        </span>
      </span>
    </>
  );

  const className =
    "flex items-start gap-2.5 rounded-xl border border-line px-3 py-2.5 transition-colors duration-(--duration-fast)";

  if (!event.href) {
    return <div className={className}>{body}</div>;
  }

  return (
    <Link
      href={event.href}
      className={`${className} hover:border-line-strong hover:bg-surface-2`}
    >
      {body}
    </Link>
  );
}

/**
 * The mark on a date only the AI report knew.
 *
 * A gazetted closing date and a model's guess at an admit-card release cannot
 * look the same on a calendar someone plans around. It is a single character
 * with a title and screen-reader text rather than a badge, because it appears
 * on most rows and a badge on most rows is noise.
 */
function PredictedMark() {
  return (
    <span className="ml-1 font-normal text-ink-3" title="Expected — not officially confirmed">
      <span aria-hidden>~</span>
      <span className="sr-only"> (expected, not officially confirmed)</span>
    </span>
  );
}

/* ── The lists ──────────────────────────────────────────────────────────── */

interface SubjectGroup {
  key: string;
  subject: string;
  organization: string | null;
  href: string | null;
  source: "tracked" | "saved";
  /** Every date for this exam, earliest first. */
  events: PersonalEvent[];
  /** The soonest date that has not passed. */
  next: PersonalEvent | null;
  daysToNext: number | null;
}

function SubjectCard({ group, today }: { group: SubjectGroup; today: string }) {
  const days = group.daysToNext;
  const urgent = days !== null && days <= 7;

  // Past dates are dropped from the chips but kept in the grid. A card is a
  // plan; a row saying applications opened five weeks ago is not actionable,
  // and it pushes the exam date off the bottom of a phone screen.
  const ahead = group.events.filter((e) => e.date >= today);

  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="line-clamp-2 text-sm font-bold leading-snug text-ink">
            {group.subject}
          </p>
          <p className="cond mt-1 text-2xs font-semibold tracking-[0.06em] text-ink-3 uppercase">
            {group.organization ? `${group.organization} · ` : ""}
            {group.source === "tracked" ? "Tracked" : "Saved"}
          </p>
        </div>

        {days !== null ? (
          <span
            className={[
              "shrink-0 rounded-full px-2 py-0.5 text-2xs font-bold tabular",
              urgent ? "bg-ev-close-soft text-ev-close" : "bg-surface-2 text-ink-2",
            ].join(" ")}
          >
            {days === 0 ? "Today" : `${String(days)}d`}
          </span>
        ) : null}
      </div>

      {ahead.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {ahead.map((event) => (
            <DateChip key={event.id} event={event} />
          ))}
        </div>
      ) : null}
    </>
  );

  const className =
    "rounded-2xl border border-line bg-surface p-3.5 shadow-card transition-all duration-(--duration-base)";

  if (!group.href) {
    return <article className={className}>{body}</article>;
  }

  return (
    <Link
      href={group.href}
      className={`${className} block hover:border-line-strong hover:shadow-card-hover active:scale-[0.99]`}
    >
      {body}
    </Link>
  );
}

function DateChip({ event }: { event: PersonalEvent }) {
  const meta = EVENT_META[event.type];
  return (
    <span
      className={`rounded-lg px-2 py-1 text-2xs font-semibold tabular ${meta.bg} ${meta.fg}`}
    >
      {meta.short}
      {event.phase ? ` ${event.phase}` : ""} · {shortDate(event.date)}
      {event.predicted ? <span aria-hidden>~</span> : null}
    </span>
  );
}

function EmptyCalendar() {
  return (
    <section className="mt-7 rounded-2xl border border-line bg-surface p-5 text-center shadow-card">
      <h2 className="text-sm font-bold text-ink">Your calendar is empty</h2>
      <p className="mx-auto mt-1.5 max-w-xs text-sm text-ink-2">
        This page shows the dates for exams you save or track — not every deadline on the site.
        Save a notification or start tracking one and its dates appear here.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link
          href="/jobs"
          className="rounded-lg bg-accent px-3.5 py-2 text-xs font-bold text-on-accent transition-colors hover:bg-accent-hover"
        >
          Browse notifications
        </Link>
        <Link
          href="/tracker"
          className="rounded-lg border border-line px-3.5 py-2 text-xs font-bold text-ink-2 transition-colors hover:border-line-strong hover:bg-surface-2 hover:text-ink"
        >
          My Exams
        </Link>
      </div>
    </section>
  );
}

/* ── Grouping ───────────────────────────────────────────────────────────── */

/**
 * Events regrouped onto one card per exam.
 *
 * The list below the grid is a list of *exams*, not of dates: five chips on one
 * card is one glance, five cards each holding one chip is five. Ordering is by
 * how soon the exam next needs attention, which is why `next` is computed here
 * and not read off the first element — the first element may be months past.
 */
function groupBySubject(events: PersonalEvent[], today: string): SubjectGroup[] {
  const groups = new Map<string, SubjectGroup>();

  for (const event of events) {
    let group = groups.get(event.subjectKey);
    if (!group) {
      group = {
        key: event.subjectKey,
        subject: event.subject,
        organization: event.organization,
        href: event.href,
        source: event.source,
        events: [],
        next: null,
        daysToNext: null,
      };
      groups.set(event.subjectKey, group);
    }
    group.events.push(event);
  }

  for (const group of groups.values()) {
    // `events` arrives sorted by date from the server, and a Map preserves
    // insertion order, so each group's list is already earliest-first.
    const next = group.events.find((e) => e.date >= today) ?? null;
    group.next = next;
    group.daysToNext = next ? daysUntilFrom(today, next.date) : null;
  }

  return [...groups.values()].sort((a, b) => {
    // Exams with nothing ahead sink, whatever their past dates say.
    if (a.daysToNext === null) return b.daysToNext === null ? 0 : 1;
    if (b.daysToNext === null) return -1;
    return a.daysToNext - b.daysToNext;
  });
}

/** One entry per type, in lifecycle order — a day with two exam dates gets one dot. */
function dedupeTypes(events: PersonalEvent[]): CalendarEventType[] {
  const seen = new Set<CalendarEventType>();
  const out: CalendarEventType[] = [];
  for (const event of events) {
    if (seen.has(event.type)) continue;
    seen.add(event.type);
    out.push(event.type);
  }
  return out;
}

/* ── Date helpers ───────────────────────────────────────────────────────── */
// UTC parts throughout, for the reason stated in the query module: a local
// `Date` resolves month boundaries in the browser's zone, and the off-by-one
// that produces only shows up for readers west of Greenwich.

interface MonthCursor {
  year: number;
  month: number;
}

const WEEKDAYS = [
  { key: "mon", short: "Mo", full: "Monday" },
  { key: "tue", short: "Tu", full: "Tuesday" },
  { key: "wed", short: "We", full: "Wednesday" },
  { key: "thu", short: "Th", full: "Thursday" },
  { key: "fri", short: "Fr", full: "Friday" },
  { key: "sat", short: "Sa", full: "Saturday" },
  { key: "sun", short: "Su", full: "Sunday" },
] as const;

const pad = (n: number) => String(n).padStart(2, "0");

function monthOf(date: string): MonthCursor {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

function monthKey(cursor: MonthCursor): string {
  return `${String(cursor.year)}-${pad(cursor.month)}`;
}

function shiftMonth(cursor: MonthCursor, by: number): MonthCursor {
  const zero = cursor.year * 12 + (cursor.month - 1) + by;
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
}

/** `monthName` takes two arguments; this spreads a shifted cursor into them. */
function shiftTuple(cursor: MonthCursor, by: number): [number, number] {
  const next = shiftMonth(cursor, by);
  return [next.year, next.month];
}

function monthName(year: number, month: number): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** "14 Mar" — the form that fits in a chip. */
function shortDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  });
}

/** 42 cells — six weeks — so the grid's height never changes between months. */
function monthCells(year: number, month: number, today: string): Cell[] {
  const firstOfMonth = new Date(Date.UTC(year, month - 1, 1));
  // Monday-first: `getUTCDay()` is 0 for Sunday, so Sunday becomes 6.
  const leading = (firstOfMonth.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return Array.from({ length: 42 }, (_, i) => {
    const day = i - leading + 1;
    if (day < 1 || day > daysInMonth) {
      return { date: null, day: null, isToday: false };
    }
    const date = `${String(year)}-${pad(month)}-${pad(day)}`;
    return { date, day, isToday: date === today };
  });
}
