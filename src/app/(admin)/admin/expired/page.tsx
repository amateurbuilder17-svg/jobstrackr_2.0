import Link from "next/link";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { expiredJobsAction } from "@/lib/admin/actions";
import {
  asExpiredSort,
  asExpiredYear,
  getExpiredSummary,
  getExpiredYears,
  isUnreferenced,
  listExpiredJobs,
  type ExpiredJobRow,
} from "@/lib/db/queries/admin-expired";
import { formatDate } from "@/lib/format/deadline";
import { ActionForm } from "../action-form";
import { ExpiredButtons } from "./buttons";
import { Pager } from "../pager";
import {
  Empty,
  FilterChips,
  SearchForm,
  Section,
  Stat,
  StatRow,
  TableFrame,
  Td,
  Th,
  THead,
} from "../ui";

type SearchParams = Promise<{
  page?: string;
  year?: string;
  q?: string;
  sort?: string;
}>;

const SORTS = [
  { label: "Oldest first", value: undefined },
  { label: "Newest first", value: "newest" },
  { label: "Fewest vacancies", value: "smallest" },
];

/**
 * Expired listings.
 *
 * The old admin had a tab of this name whose job was to keep the table from
 * growing without bound: filter to expired, tick, delete in chunks of a hundred.
 * Two things have changed since.
 *
 * Expiry is no longer something this page decides. `close_expired_jobs()` runs
 * at the top of every ingest and moves a published listing past its closing
 * date to `closed`, so nothing here is still reachable from a feed. The
 * question is what to do with the pile, not whether visitors can see it.
 *
 * And deleting a job is not free. `saved_jobs` and `user_calendar_events` both
 * cascade, so clearing out a listing somebody shortlisted in March removes it
 * from their list without telling either of you. The old tab had no idea which
 * rows those were. This one counts them per row, archives by default, and
 * offers delete only where the counts are zero — with the same check repeated
 * inside the delete statement, because the counts on screen are minutes old by
 * the time the form comes back.
 */
export default function AdminExpiredPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mt-6 flex flex-col gap-8">
      <Suspense fallback={<Skeleton className="h-24 w-full rounded-lg" />}>
        <Summary />
      </Suspense>

      <Section
        title="Expired listings"
        hint="Closing date already past. Archiving is reversible and takes nothing away from anyone; deleting is offered only for listings nobody has saved."
      >
        <Suspense fallback={<div className="h-20" />}>
          <Controls searchParams={searchParams} />
        </Suspense>

        <Suspense fallback={<Skeleton className="mt-3 h-96 w-full rounded-lg" />}>
          <Table searchParams={searchParams} />
        </Suspense>
      </Section>
    </div>
  );
}

async function Summary() {
  const summary = await getExpiredSummary();

  return (
    <Section title="At a glance">
      <StatRow>
        <Stat label="Expired" value={summary.totalExpired} />
        <Stat
          label="Safe to delete"
          value={summary.unreferenced}
          hint="nobody saved these"
          tone="good"
        />
        <Stat
          label="Saved by someone"
          value={summary.savedByUsers}
          hint="archive only"
          tone="warn"
        />
        {/*
          Should be zero. `close_expired_jobs` runs at the top of every ingest,
          so a number here does not mean "some listings need closing" — it means
          ingestion has stopped running, and that is the actual finding.
        */}
        <Stat
          label="Still published"
          value={summary.stillPublished}
          hint={summary.stillPublished > 0 ? "ingest may have stopped" : "as expected"}
          tone="critical"
        />
      </StatRow>
    </Section>
  );
}

async function Controls({ searchParams }: { searchParams: SearchParams }) {
  const { year, q, sort } = await searchParams;
  const years = await getExpiredYears();

  return (
    <>
      <div className="mt-3">
        <SearchForm
          action="/admin/expired"
          value={q}
          placeholder="Search titles"
          hidden={{ year, sort }}
        />
      </div>

      <FilterChips
        basePath="/admin/expired"
        param="year"
        current={year}
        options={[
          { label: "All years", value: undefined },
          // Counts on the chip, so the control says how much is behind each
          // option instead of making you click to find out.
          ...years.map((y) => ({
            label: `${String(y.year)} · ${String(y.count)}`,
            value: String(y.year),
          })),
        ]}
        extra={{ q, sort }}
      />

      <FilterChips
        basePath="/admin/expired"
        param="sort"
        current={sort}
        options={SORTS}
        extra={{ q, year }}
      />
    </>
  );
}

async function Table({ searchParams }: { searchParams: SearchParams }) {
  const { page, year, q, sort } = await searchParams;

  const result = await listExpiredJobs({
    page: Number(page ?? 1),
    year: asExpiredYear(year),
    query: q,
    sort: asExpiredSort(sort),
  });

  const empty = result.rows.length === 0;
  const deletable = result.rows.filter(isUnreferenced).length;

  return (
    // One form, two submit buttons that differ only by the `intent` they carry.
    // The selection is plain checkboxes in the DOM, so choosing between "archive
    // these" and "delete these" costs no client state and no second pass.
    <ArchiveOrDelete empty={empty} deletable={deletable} rows={result.rows}>
      {empty ? (
        <Empty>
          {q || year ? "No expired listing matches." : "Nothing has expired. Table is clear."}
        </Empty>
      ) : (
        <>
          <TableFrame minWidth="52rem">
            <THead>
              <Th width="2.5rem">
                <span className="sr-only">Select</span>
              </Th>
              <Th>Title</Th>
              <Th width="6.5rem">Status</Th>
              <Th width="7rem">Closed</Th>
              <Th align="right" width="6rem">
                Vacancies
              </Th>
              <Th width="9rem">Held by</Th>
            </THead>
            <tbody>
              {result.rows.map((row) => {
                const free = isUnreferenced(row);
                return (
                  <tr key={row.jobId} className="border-t border-line/60">
                    <Td align="center">
                      <input
                        type="checkbox"
                        name="selected"
                        value={row.jobId}
                        aria-label={`Select ${row.title}`}
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
                      {row.orgName ? (
                        <span className="block truncate text-2xs text-ink-3">
                          {row.orgName}
                        </span>
                      ) : null}
                    </td>
                    <Td>
                      <Badge tone={row.status === "published" ? "critical" : "neutral"}>
                        {row.status}
                      </Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-ink-2">
                      {formatDate(row.lastDate) ?? "—"}
                    </Td>
                    <Td align="right" className="text-ink-3">
                      {row.vacancies === null ? "—" : row.vacancies.toLocaleString("en-IN")}
                    </Td>
                    <Td>
                      {free ? (
                        <span className="text-2xs text-ink-3">nobody</span>
                      ) : (
                        <span className="text-2xs text-warn">
                          {row.saves > 0 ? `${String(row.saves)} saved` : null}
                          {row.saves > 0 && row.reminders > 0 ? ", " : null}
                          {row.reminders > 0
                            ? `${String(row.reminders)} reminder${row.reminders === 1 ? "" : "s"}`
                            : null}
                        </span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableFrame>

          <Pager
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
            basePath="/admin/expired"
            params={{ year, q, sort }}
          />
        </>
      )}
    </ArchiveOrDelete>
  );
}

/**
 * The form, wrapping both the table and the empty state.
 *
 * Kept mounted in both branches, like the other maintenance pages: archiving the
 * last page of expired listings revalidates this route into the empty state, and
 * a form that unmounted there would discard its own "Archived 50 listings".
 */
function ArchiveOrDelete({
  empty,
  deletable,
  rows,
  children,
}: {
  empty: boolean;
  deletable: number;
  rows: ExpiredJobRow[];
  children: React.ReactNode;
}) {
  return (
    <ActionForm
      action={expiredJobsAction}
      submitLabel="Archive selected"
      className="mt-1"
      canSubmit={!empty}
      footer={<ExpiredButtons deletable={deletable} total={rows.length} />}
    >
      {children}

      {empty ? null : (
        <p className="mt-3 mb-3 max-w-prose text-xs text-ink-3">
          Archiving is reversible and invisible to anyone who saved a listing. Deleting is
          permanent, and is only applied to the {String(deletable)} of {String(rows.length)}{" "}
          rows on this page that nobody has saved or set a reminder for — the rest are skipped
          even if ticked, and the result says how many actually went.
        </p>
      )}
    </ActionForm>
  );
}
