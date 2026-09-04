import type { CalendarEventType } from "@/lib/db/queries/calendar";

/**
 * How each event type looks and reads.
 *
 * The colour classes are spelled out per type rather than composed from the
 * type string, because Tailwind scans source text: `bg-ev-${type}-soft` would
 * compile to nothing at all and the chips would render transparent. Every class
 * a build needs has to appear in a file, intact, and this is that file.
 *
 * `label` is the reader's word for the date, `short` is the same word with room
 * for a date beside it in a 2xs chip. `dot` orders the legend and the stacking
 * inside a day cell — earliest in the lifecycle first, so a cell holding both a
 * closing and a result reads left to right in the order they happen.
 */
export interface EventMeta {
  label: string;
  short: string;
  /** Text and dot. */
  fg: string;
  /** Chip background. */
  bg: string;
  /** Position in the exam lifecycle, for ordering. */
  order: number;
}

export const EVENT_META: Record<CalendarEventType, EventMeta> = {
  application_open: {
    label: "Applications open",
    short: "Opens",
    fg: "text-ev-open",
    bg: "bg-ev-open-soft",
    order: 0,
  },
  application_close: {
    label: "Last date to apply",
    short: "Last date",
    fg: "text-ev-close",
    bg: "bg-ev-close-soft",
    order: 1,
  },
  admit_card: {
    label: "Admit card",
    short: "Admit card",
    fg: "text-ev-admit",
    bg: "bg-ev-admit-soft",
    order: 2,
  },
  exam_date: {
    label: "Exam day",
    short: "Exam",
    fg: "text-ev-exam",
    bg: "bg-ev-exam-soft",
    order: 3,
  },
  result: {
    label: "Result",
    short: "Result",
    fg: "text-ev-result",
    bg: "bg-ev-result-soft",
    order: 4,
  },
};

/** The dot colour, as a background rather than a text colour. */
export const EVENT_DOT: Record<CalendarEventType, string> = {
  application_open: "bg-ev-open",
  application_close: "bg-ev-close",
  admit_card: "bg-ev-admit",
  exam_date: "bg-ev-exam",
  result: "bg-ev-result",
};

export const EVENT_ORDER = Object.keys(EVENT_META) as CalendarEventType[];
