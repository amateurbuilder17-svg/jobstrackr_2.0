/**
 * What changed on a listing.
 *
 * Pure functions, and no database import — which is not tidiness. `ingest.ts`
 * imports the Supabase client, and that module validates the environment at
 * import time, so anything reachable from it cannot be unit-tested without a
 * full `.env`. The differ decides what people are told about a deadline they
 * are counting on; it is exactly the logic that should be testable with no
 * setup at all.
 */

/**
 * The fields worth telling someone about.
 *
 * Deliberately short. A change feed that reports every scraper wobble — a
 * reworded title, a whitespace difference in a location — trains people to
 * ignore it, and the one entry that mattered scrolls past with the noise. These
 * five are the ones that change what a person does: whether they can still
 * apply, when, how many posts there are, and what it costs.
 */
export type WatchedField =
  "last_date" | "application_start_date" | "vacancies" | "application_fee" | "status";

export interface JobChange {
  dedupeKey: string;
  field: WatchedField;
  oldValue: string | null;
  newValue: string | null;
}

/** The shape both sides of the comparison are reduced to. */
export interface ComparableRow {
  last_date: string | null;
  application_start_date: string | null;
  vacancies: number | null;
  vacancies_display: string | null;
  application_fee: number | null;
  status: string;
}

/**
 * How each watched field is rendered for comparison.
 *
 * `vacancies` is one logical field over two columns. The typed count and the
 * scraped display string are two spellings of the same fact, and emitting a row
 * for each would say the same thing twice. The display string wins because it
 * is what the page shows — so a parser correction that leaves the printed
 * answer identical correctly reports nothing.
 */
const WATCHED: Record<WatchedField, (row: ComparableRow) => string | null> = {
  last_date: (r) => r.last_date,
  application_start_date: (r) => r.application_start_date,
  vacancies: (r) => r.vacancies_display ?? (r.vacancies === null ? null : String(r.vacancies)),
  application_fee: (r) => (r.application_fee === null ? null : String(r.application_fee)),
  status: (r) => r.status,
};

export const WATCHED_FIELDS = Object.keys(WATCHED) as WatchedField[];

/** Columns the diff has to read back. Every one feeds a `WATCHED` entry. */
export const CHANGE_SELECT = `
  dedupe_key, content_hash,
  last_date, application_start_date,
  vacancies, vacancies_display, application_fee, status
` as const;

/** The watched fields of a row, as comparable strings. */
export function comparableFields(row: ComparableRow): Record<WatchedField, string | null> {
  return Object.fromEntries(WATCHED_FIELDS.map((f) => [f, WATCHED[f](row)])) as Record<
    WatchedField,
    string | null
  >;
}

/** Every watched field that differs between two versions of a row. */
export function diffWatched(
  dedupeKey: string,
  before: ComparableRow,
  after: ComparableRow,
): JobChange[] {
  const a = comparableFields(before);
  const b = comparableFields(after);

  return WATCHED_FIELDS.flatMap((field) =>
    a[field] === b[field] ? [] : [{ dedupeKey, field, oldValue: a[field], newValue: b[field] }],
  );
}

/**
 * A change as a sentence, for the job page.
 *
 * Written from the reader's side: they care that the window moved, not that a
 * column was updated. The date formatting is left to the caller, which knows
 * about IST; this only decides the wording.
 */
export function describeChange(
  field: WatchedField,
  oldValue: string | null,
  newValue: string | null,
  format: (value: string | null) => string,
): { headline: string; detail: string | null } {
  const from = format(oldValue);
  const to = format(newValue);

  switch (field) {
    case "last_date":
      return {
        headline: newValue ? `Closing date moved to ${to}` : "Closing date withdrawn",
        detail: oldValue ? `Previously ${from}` : null,
      };
    case "application_start_date":
      return {
        headline: newValue ? `Applications now open from ${to}` : "Opening date withdrawn",
        detail: oldValue ? `Previously ${from}` : null,
      };
    case "vacancies":
      return {
        headline: newValue ? `Vacancies revised to ${to}` : "Vacancy count withdrawn",
        detail: oldValue ? `Previously ${from}` : null,
      };
    case "application_fee":
      return {
        headline:
          newValue === "0"
            ? "Application fee removed"
            : newValue
              ? `Application fee is now ₹${to}`
              : "Application fee withdrawn",
        detail: oldValue ? `Previously ${oldValue === "0" ? "no fee" : `₹${from}`}` : null,
      };
    case "status":
      return {
        headline:
          newValue === "closed"
            ? "Applications have closed"
            : newValue === "published"
              ? "This listing reopened"
              : `Status changed to ${to}`,
        detail: null,
      };
  }
}
