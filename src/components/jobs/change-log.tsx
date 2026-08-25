import { ClockIcon } from "@/components/icons";
import type { JobChangeRow } from "@/lib/db/queries/jobs";
import { formatDate } from "@/lib/format/deadline";
import { describeChange, WATCHED_FIELDS, type WatchedField } from "@/lib/sync/changes";

/**
 * What changed on this listing.
 *
 * The feature nobody else in this category has, and the one people actually
 * worry about: government notices get corrected constantly — closing dates
 * extended, vacancy counts revised, exams postponed — and the departments
 * simply replace the PDF, leaving no trace that anything moved.
 *
 * Placed directly under the summary block, above the prose. Someone returning
 * to a listing they saved is asking one question, and it is this one.
 *
 * A Server Component reading rows that were written by ingestion into a page
 * that is statically generated, so this costs nothing per visitor.
 */
export function ChangeLog({ changes }: { changes: JobChangeRow[] }) {
  const entries = changes.flatMap((change) => {
    // `field` is a string from the database. The check constraint keeps it
    // inside the known set, but a row written before a field was retired would
    // still parse — so it is narrowed here rather than trusted, and anything
    // unrecognised is dropped rather than rendered as a raw column name.
    if (!isWatched(change.field)) return [];

    const { headline, detail } = describeChange(
      change.field,
      change.old_value,
      change.new_value,
      formatValue(change.field),
    );

    return [{ id: change.id, headline, detail, at: change.changed_at }];
  });

  if (entries.length === 0) return null;

  return (
    <section className="mt-6" aria-labelledby="change-log">
      <h2 id="change-log" className="text-lg font-semibold text-ink">
        What changed
      </h2>
      <p className="mt-1 text-sm text-ink-3">
        Amendments we recorded from the official notice since this listing first appeared.
      </p>

      {/* An ordered list, because the sequence is the information — a screen
          reader should hear "1 of 3" rather than three unrelated paragraphs. */}
      <ol className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {entries.map((entry) => (
          <li key={entry.id} className="flex items-start gap-3 px-4 py-3">
            <ClockIcon className="mt-0.5 size-3.5 shrink-0 text-ink-3" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">{entry.headline}</p>
              {entry.detail ? (
                <p className="tabular mt-0.5 text-xs text-ink-3">{entry.detail}</p>
              ) : null}
            </div>
            <time
              dateTime={entry.at}
              className="cond tabular shrink-0 text-xs text-ink-3"
              suppressHydrationWarning
            >
              {formatDate(entry.at)}
            </time>
          </li>
        ))}
      </ol>
    </section>
  );
}

function isWatched(field: string): field is WatchedField {
  return (WATCHED_FIELDS as string[]).includes(field);
}

/**
 * How a stored value is printed.
 *
 * Dates become "31 Aug 2026"; everything else is already the string the page
 * shows, because the differ compares display values rather than typed ones.
 */
function formatValue(field: WatchedField): (value: string | null) => string {
  const isDate = field === "last_date" || field === "application_start_date";
  return (value) => {
    if (value === null) return "—";
    return isDate ? (formatDate(value) ?? value) : value;
  };
}
