/**
 * Reading a calendar date out of what a notification printed.
 *
 * `important_dates` is `[{event, date}]` with a deliberately free-text `date`,
 * because "Third week of March" is a real answer and forcing it into a date
 * column would have to invent a day. So the column keeps the text, and this is
 * the thing that decides, for one entry at a time, whether the text names a day
 * precisely enough to write into `jobs.last_date`.
 *
 * The rule that matters most is the one about ambiguity: **it must return null
 * rather than guess.** The old pipeline had a fallback that set an unparseable
 * deadline to today-plus-a-year "so the job stays active", and the result was
 * fabricated dates that rendered exactly like real ones and kept dead postings
 * on the site for twelve months. A null here means an admin sees the row with
 * an empty box and types the date; a wrong answer means nobody ever finds out.
 *
 * Day-first throughout. Every source here is Indian and writes 03/09/2026 for
 * the third of September; there is no month-first reading to disambiguate
 * against, so 09/03/2026 is the ninth of March and never September the third.
 */

const MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

/** Values that look like data but say nothing. Kept in step with `normalize.ts`. */
const PLACEHOLDER =
  /^(tbd|to\s*be\s*announced|to\s*be\s*notified|n\.?\s*\/?\s*a\.?|na|nil|none|not\s*available|not\s*announced|not\s*yet\s*announced|soon|-+|—+)$/i;

/**
 * A `YYYY-MM-DD` date, or null when the text does not name one unambiguously.
 *
 * Accepts, in order: ISO, D/M/YYYY, "30 June 2026", "June 30, 2026". Anything
 * else — a month with no day, a range, a week, a season — is null on purpose.
 */
export function parseLooseDate(value: string | null | undefined): string | null {
  if (!value) return null;

  // Times and their parentheses are noise here: "30/06/2026 (till 5:00 PM)"
  // is a date with an office-hours note attached, not a datetime.
  //
  // A dotted time ("5.00 PM") must carry its meridiem to be stripped. Without
  // that condition the pattern also matches the first half of "30.06.2026" and
  // deletes the date it was meant to preserve.
  const text = value
    .replace(/\s+/g, " ")
    .replace(/\(?\s*(?:till|up\s*to|before|from)?\s*\d{1,2}:\d{2}\s*(?:am|pm)?\s*\)?/gi, " ")
    .replace(/\(?\s*(?:till|up\s*to|before|from)?\s*\d{1,2}\.\d{2}\s*(?:am|pm)\s*\)?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (text === "" || PLACEHOLDER.test(text)) return null;

  // A range names two days and this function returns one. "01/06/2026 to
  // 30/06/2026" is an application *window*, and silently taking either end
  // would write a start date into a closing-date column half the time.
  //
  // The dashes are matched separately from the words: `\b` asserts a
  // word-character boundary, and an en dash has none on either side, so
  // folding them into one alternation silently never matches a dashed range.
  const ranged = /\b(?:to|till|until|through|upto|up\s+to)\b/i.test(text) || /[–—]/.test(text);
  if (ranged && countDates(text) > 1) return null;

  const iso = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return build(Number(iso[3]), Number(iso[2]), Number(iso[1]));

  // 30/06/2026, 30-6-2026, 30.06.2026 — and 30/06/26, where a two-digit year
  // is read as 20xx. These sources do not print 20th-century deadlines.
  const numeric = /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})\b/.exec(text);
  if (numeric) {
    const year = Number(numeric[3]);
    return build(Number(numeric[1]), Number(numeric[2]), year < 100 ? 2000 + year : year);
  }

  // 30 June 2026 · 30th Jun, 2026 · 30-Jun-2026
  const dayFirst =
    /\b(\d{1,2})(?:st|nd|rd|th)?[\s\-.]*([A-Za-z]{3,9})\.?,?[\s\-.]*(\d{4})\b/.exec(text);
  if (dayFirst?.[2]) {
    const month = MONTHS[dayFirst[2].toLowerCase()];
    if (month !== undefined) return build(Number(dayFirst[1]), month, Number(dayFirst[3]));
  }

  // June 30, 2026 · Jun 30 2026
  const monthFirst =
    /\b([A-Za-z]{3,9})\.?[\s\-.]*(\d{1,2})(?:st|nd|rd|th)?,?[\s\-.]*(\d{4})\b/.exec(text);
  if (monthFirst?.[1]) {
    const month = MONTHS[monthFirst[1].toLowerCase()];
    if (month !== undefined) return build(Number(monthFirst[2]), month, Number(monthFirst[3]));
  }

  return null;
}

/**
 * Which entry in a notification's date table is the closing date.
 *
 * Scored rather than matched, because these tables are inconsistent: one prints
 * "Last Date to Apply Online", another "Closing Date", another just "Last
 * Date". Negative scores are the important half — "Last Date for Fee Payment"
 * is usually a day or two *after* the application closes, and picking it would
 * keep a closed listing open.
 */
const CLOSING =
  /\b(last\s*date|closing\s*date|end\s*date|deadline|apply\s*(?:online\s*)?(?:last|end)|last\s*day)\b/i;
const NOT_CLOSING =
  /\b(start|begin|open|from|exam|admit|result|answer|interview|correction|fee\s*payment|payment)\b/i;

export interface DateEntry {
  event: string;
  date: string;
}

export interface ClosingDateGuess {
  /** The entry chosen, or null when nothing in the table looked like one. */
  entry: DateEntry | null;
  /** Its parsed value. Null whenever `entry` is null or did not parse. */
  date: string | null;
}

export function guessClosingDate(entries: DateEntry[]): ClosingDateGuess {
  let best: { entry: DateEntry; date: string; score: number } | null = null;

  for (const entry of entries) {
    const parsed = parseLooseDate(entry.date);
    // An entry whose text does not name a day cannot be the answer, however
    // convincingly its label reads.
    if (parsed === null) continue;

    let score = 0;
    if (CLOSING.test(entry.event)) score += 2;
    if (NOT_CLOSING.test(entry.event)) score -= 3;

    // Nothing in the table looked like a closing date at all. Offering the
    // latest unlabelled date would be a guess dressed as an answer.
    if (score <= 0) continue;

    if (!best || score > best.score || (score === best.score && parsed > best.date)) {
      best = { entry, date: parsed, score };
    }
  }

  return best ? { entry: best.entry, date: best.date } : { entry: null, date: null };
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

function countDates(text: string): number {
  const numeric = text.match(/\b\d{1,2}[/.\-]\d{1,2}[/.\-](?:\d{2}|\d{4})\b/g) ?? [];
  const named =
    text.match(/\b\d{1,2}(?:st|nd|rd|th)?[\s\-.]*[A-Za-z]{3,9}\.?,?[\s\-.]*\d{4}\b/g) ?? [];
  return numeric.length + named.length;
}

/**
 * Builds the string, and refuses anything that is not a real day.
 *
 * The round-trip through `Date` is what rejects 31/02 — the components are
 * individually in range, and only reconstruction shows that the calendar moved
 * them. `Date.UTC` rather than the local constructor, because the machine
 * running this is not in India and a local-midnight date is a different day
 * once it crosses back to a string.
 */
function build(day: number, month: number, year: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Not a hard bound — a correction window can close in the year after the
  // notification — but it does reject a page number read as a year.
  if (year < 2000 || year > 2100) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCDate() !== day || date.getUTCMonth() !== month - 1) return null;

  return date.toISOString().slice(0, 10);
}
