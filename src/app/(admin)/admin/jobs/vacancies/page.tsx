import Link from "next/link";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { applyVacancyFixesAction } from "@/lib/admin/actions";
import { listVacancyMismatches } from "@/lib/db/queries/admin-jobs";
import { ActionForm } from "../../action-form";
import { Pager } from "../../pager";
import { Empty, Section, Td, TableFrame, Th, THead } from "../../ui";

type SearchParams = Promise<{ page?: string }>;

/**
 * The vacancy checker.
 *
 * Scraped titles carry the post count in their text — "…Recruitment 2026 -
 * Apply Online for 70 Posts" — and `jobs.vacancies` disagrees often enough to
 * be worth a tool. The parse lives in `admin_vacancy_from_title` (migration
 * 0034), a faithful port of the old page's regex, so what is listed here is
 * what the old checker would have listed.
 *
 * What changed is where the work happens. The old one fetched every job row
 * into the browser to run that regex; this one runs it in Postgres and receives
 * only the disagreements — about forty rows, against 5,231.
 *
 * Every row is pre-ticked, because an admin arriving here has already decided
 * to trust the parser; the ones to think about are the few they untick. The
 * number is editable for the same reason: the title is evidence, not proof.
 */
export default function AdminVacanciesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mt-6">
      <p className="mb-4 text-xs">
        <Link href="/admin/jobs" className="text-ink-3 hover:text-ink hover:underline">
          ← Jobs
        </Link>
      </p>

      <Section
        title="Vacancy mismatch"
        hint="The count in the title disagrees with the count in the column. Applying a fix clears the display string, which exists to carry text a number cannot."
      >
        <Suspense fallback={<Skeleton className="mt-3 h-96 w-full rounded-lg" />}>
          <Table searchParams={searchParams} />
        </Suspense>
      </Section>
    </div>
  );
}

async function Table({ searchParams }: { searchParams: SearchParams }) {
  const { page } = await searchParams;
  const result = await listVacancyMismatches(Number(page ?? 1));
  const empty = result.rows.length === 0;

  return (
    // The form wraps the empty state as well as the table, and stays mounted
    // either way. Applying the last fix revalidates this page into the empty
    // branch, and a form that unmounted there would take its own "Updated 26
    // listings" with it — leaving an empty table that looks identical to a
    // silent no-op.
    <ActionForm
      action={applyVacancyFixesAction}
      submitLabel="Apply ticked fixes"
      pendingLabel="Applying…"
      variant="primary"
      className="mt-1"
      canSubmit={!empty}
    >
      {empty ? (
        <Empty>Every title agrees with its column. Nothing to fix.</Empty>
      ) : (
        <>
          <TableFrame minWidth="46rem">
            <THead>
              <Th width="2.5rem">
                {/* No "select all": every row starts ticked, so the control that
                would matter is "select none", and unticking four boxes is not
                a feature worth a client component. */}
                <span className="sr-only">Apply</span>
              </Th>
              <Th>Title</Th>
              <Th align="right" width="6rem">
                Stored
              </Th>
              <Th align="right" width="6rem">
                From title
              </Th>
              <Th width="8rem">Display</Th>
            </THead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.jobId} className="border-t border-line/60">
                  <Td align="center">
                    <input
                      type="checkbox"
                      name="fix"
                      // Id and value travel together in one field, so the action
                      // cannot be handed a job id with somebody else's number
                      // attached by editing one input and not the other.
                      value={`${row.jobId}:${String(row.extracted)}`}
                      defaultChecked
                      aria-label={`Set ${row.title} to ${String(row.extracted)} vacancies`}
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
                  </td>
                  <Td align="right" className="text-ink-3">
                    {row.stored === null ? "—" : row.stored.toLocaleString("en-IN")}
                  </Td>
                  <Td align="right" className="font-medium text-ink">
                    {row.extracted.toLocaleString("en-IN")}
                  </Td>
                  <Td className="truncate text-2xs text-ink-3">
                    {row.vacanciesDisplay ?? "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableFrame>

          <Pager
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
            basePath="/admin/jobs/vacancies"
            params={{}}
          />

          <p className="mt-3 mb-3 text-xs text-ink-3">
            Ticks apply to this page only — paging away discards them, so work one page at a
            time.
          </p>
        </>
      )}
    </ActionForm>
  );
}
