import Link from "next/link";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { applyLastDatesAction } from "@/lib/admin/actions";
import { guessClosingDate } from "@/lib/admin/dates";
import { listMissingLastDate } from "@/lib/db/queries/admin-jobs";
import { ActionForm } from "../../action-form";
import { Empty, Section, Td, TableFrame, Th, THead } from "../../ui";

/**
 * Listings with no closing date, and the date their notification printed.
 *
 * `jobs.last_date` is null when the scrape produced nothing a date column would
 * accept — but the date is usually still there in `job_details.important_dates`
 * as the free text it was printed in ("30 Jun 2026", "Last Date to Apply").
 *
 * Two rules carried over deliberately from the old checker, both of which cost
 * it real bugs before they were:
 *
 *   **Never guess.** `parseLooseDate` returns null for "Third week of March"
 *   rather than picking a Wednesday. The old pipeline's fallback set an
 *   unparseable deadline to today-plus-a-year "so the job stays active", and
 *   the result was fabricated dates that rendered exactly like real ones and
 *   kept dead postings on the site for twelve months.
 *
 *   **Never take the fee deadline.** It usually falls a day or two after the
 *   application closes, so picking it keeps a closed listing open. See the
 *   scoring in `guessClosingDate`.
 *
 * Which is why the suggestion lands in an editable box and only ticked rows are
 * written. The parser proposes; a person decides.
 */
export default function AdminDatesPage() {
  return (
    <div className="mt-6">
      <p className="mb-4 text-xs">
        <Link href="/admin/jobs" className="text-ink-3 hover:text-ink hover:underline">
          ← Jobs
        </Link>
      </p>

      <Section
        title="Missing closing dates"
        hint="Listings with no deadline whose notification printed one. The suggestion is editable; nothing is written until you tick it."
      >
        <Suspense fallback={<Skeleton className="mt-3 h-96 w-full rounded-lg" />}>
          <Table />
        </Suspense>
      </Section>
    </div>
  );
}

async function Table() {
  const { rows, total } = await listMissingLastDate(100);

  // The parse happens here rather than in the query, because two rows out of
  // three have a date table with nothing decidable in it and there is no point
  // rendering them. Filtering after the fetch is fine — the fetch was already
  // bounded to a hundred candidates.
  const candidates = rows.flatMap((row) => {
    const guess = guessClosingDate(row.entries);
    return guess.date ? [{ ...row, guess: guess.date, event: guess.entry?.event ?? "" }] : [];
  });

  const empty = candidates.length === 0;

  return (
    // Mounted in both branches on purpose — see `canSubmit` in ActionForm.
    // Filling in the last date revalidates this page into the empty state, and
    // a form that unmounted there would discard its own confirmation.
    <ActionForm
      action={applyLastDatesAction}
      submitLabel="Apply ticked dates"
      pendingLabel="Applying…"
      variant="primary"
      className="mt-1"
      canSubmit={!empty}
    >
      {empty ? (
        <Empty>
          {total === 0
            ? "Every listing has a closing date."
            : `${String(total)} listings are missing one, but none printed a date specific enough to read. They need a person and the notification PDF.`}
        </Empty>
      ) : (
        <>
          <p className="mt-3 text-xs text-ink-3">
            {String(candidates.length)} of {String(total)} listings missing a date printed one
            that could be read.
          </p>

          <TableFrame minWidth="48rem">
            <THead>
              <Th width="2.5rem">
                <span className="sr-only">Apply</span>
              </Th>
              <Th>Title</Th>
              <Th width="14rem">Read from</Th>
              <Th width="9rem">Closing date</Th>
            </THead>
            <tbody>
              {candidates.map((row) => (
                <tr key={row.jobId} className="border-t border-line/60">
                  <Td align="center">
                    <input
                      type="checkbox"
                      name="selected"
                      value={row.jobId}
                      defaultChecked
                      aria-label={`Set a closing date for ${row.title}`}
                      className="size-4 accent-[var(--color-accent)]"
                    />
                  </Td>
                  <td className="max-w-0 px-3 py-2">
                    <Link
                      href={`/jobs/${row.slug}`}
                      className="block truncate font-medium text-ink hover:text-accent hover:underline"
                    >
                      {row.title}
                    </Link>
                    {row.display ? (
                      <span className="block truncate text-2xs text-ink-3">
                        currently shows “{row.display}”
                      </span>
                    ) : null}
                  </td>
                  <Td className="text-2xs text-ink-3">
                    <span className="block truncate">{row.event || "unlabelled entry"}</span>
                  </Td>
                  <Td>
                    <input
                      type="date"
                      name={`date:${row.jobId}`}
                      defaultValue={row.guess}
                      aria-label={`Closing date for ${row.title}`}
                      className="h-8 w-full rounded-md border border-line bg-surface px-2 text-xs text-ink focus:border-line-strong focus:outline-none"
                    />
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableFrame>

          <p className="mt-3 mb-3 text-xs text-ink-3">
            Writing a date also clears the free-text display string, which exists only to say
            that there was no real date.
          </p>
        </>
      )}
    </ActionForm>
  );
}
