import Link from "next/link";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { closeExpiredJobsAction } from "@/lib/admin/actions";
import { asJobStatus, listJobsForAdmin } from "@/lib/db/queries/admin";
import { formatDate } from "@/lib/format/deadline";
import { ActionForm } from "../action-form";
import { Pager } from "../pager";
import { Empty, FilterChips, SearchForm, Section, Td, TableFrame, Th, THead } from "../ui";

type SearchParams = Promise<{ page?: string; status?: string; q?: string }>;

const STATUS_FILTERS = [
  { label: "All", value: undefined },
  { label: "Published", value: "published" },
  { label: "Draft", value: "draft" },
  { label: "Closed", value: "closed" },
  { label: "Archived", value: "archived" },
];

/**
 * The jobs table, and the entrance to the three maintenance tools.
 *
 * Fifty rows, server-side, always. The old Admin page pulled all ~5,231 jobs
 * uncached on every mount — roughly 14 MB — because the table filtered and
 * sorted in the browser. There is no code path here that can fetch more than a
 * page, which is the point: the regression is structurally unavailable rather
 * than merely discouraged.
 *
 * The tools live on their own routes rather than behind tabs on this one, for
 * the same reason. A tab is a thing you render eagerly and hide; a route is a
 * thing you only pay for when someone asks. The old page mounted all sixteen of
 * its tabs' queries at once.
 */
export default function AdminJobsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mt-6 flex flex-col gap-8">
      <Tools />

      <Section title="Jobs" hint="Newest edits first. Fifty per page, filtered in Postgres.">
        <Suspense fallback={<div className="h-16" />}>
          <Controls searchParams={searchParams} />
        </Suspense>

        <Suspense fallback={<Skeleton className="mt-3 h-96 w-full rounded-lg" />}>
          <Table searchParams={searchParams} />
        </Suspense>
      </Section>
    </div>
  );
}

function Tools() {
  return (
    <Section
      title="Maintenance"
      hint="Each one asks its question in the database and returns only the rows that answer it."
    >
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <Tool
          href="/admin/jobs/duplicates"
          name="Duplicates"
          what="The same posting scraped from two sources. Merges into one row, keeping saved jobs and tracker entries intact."
        />
        <Tool
          href="/admin/jobs/vacancies"
          name="Vacancy mismatch"
          what="Where the title says one post count and the column says another."
        />
        <Tool
          href="/admin/jobs/dates"
          name="Missing closing dates"
          what="Listings with no deadline, and the date their notification printed."
        />
      </div>

      <div className="mt-3">
        <ActionForm
          action={closeExpiredJobsAction}
          submitLabel="Close expired listings"
          pendingLabel="Closing…"
        >
          <p className="mb-2 text-xs text-ink-3">
            Runs nightly on its own. This is for the morning after a feed lands a batch of stale
            rows.
          </p>
        </ActionForm>
      </div>
    </Section>
  );
}

function Tool({ href, name, what }: { href: string; name: string; what: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-line bg-surface p-3 transition-colors hover:border-line-strong hover:bg-surface-2"
    >
      <span className="block text-sm font-medium text-ink">{name}</span>
      <span className="mt-1 block text-xs text-ink-3">{what}</span>
    </Link>
  );
}

async function Controls({ searchParams }: { searchParams: SearchParams }) {
  const { status, q } = await searchParams;

  return (
    <>
      <div className="mt-3">
        <SearchForm
          action="/admin/jobs"
          value={q}
          placeholder="Search titles"
          hidden={{ status }}
        />
      </div>
      <FilterChips
        basePath="/admin/jobs"
        param="status"
        current={status}
        options={STATUS_FILTERS}
        extra={{ q }}
      />
    </>
  );
}

async function Table({ searchParams }: { searchParams: SearchParams }) {
  const { page, status, q } = await searchParams;

  const result = await listJobsForAdmin({
    page: Number(page ?? 1),
    status: asJobStatus(status),
    query: q,
  });

  if (result.rows.length === 0) {
    return <Empty>No listings match.</Empty>;
  }

  return (
    <>
      <TableFrame>
        <THead>
          <Th>Title</Th>
          <Th width="7rem">Status</Th>
          <Th width="7rem">Closes</Th>
          <Th width="7rem">Updated</Th>
        </THead>
        <tbody>
          {result.rows.map((job) => (
            <tr key={job.id} className="border-t border-line/60">
              <td className="max-w-0 px-3 py-2">
                <Link
                  href={`/jobs/${job.slug}`}
                  className="block truncate font-medium text-ink hover:text-accent hover:underline"
                >
                  {job.title}
                </Link>
                {job.organization ? (
                  <span className="block truncate text-2xs text-ink-3">
                    {job.organization.short_name ?? job.organization.name}
                  </span>
                ) : null}
              </td>
              <Td>
                <Badge tone={job.status === "published" ? "good" : "neutral"}>
                  {job.status}
                </Badge>
              </Td>
              <Td className="whitespace-nowrap text-ink-2">
                {formatDate(job.last_date) ?? "—"}
              </Td>
              <Td className="whitespace-nowrap text-ink-3">
                {formatDate(job.updated_at) ?? "—"}
              </Td>
            </tr>
          ))}
        </tbody>
      </TableFrame>

      <Pager
        page={result.page}
        pageCount={result.pageCount}
        total={result.total}
        basePath="/admin/jobs"
        params={{ status, q }}
      />
    </>
  );
}
