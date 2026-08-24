import Link from "next/link";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { asJobStatus, listJobsForAdmin } from "@/lib/db/queries/admin";
import { formatDate } from "@/lib/format/deadline";
import { Pager } from "../pager";

type SearchParams = Promise<{ page?: string; status?: string; q?: string }>;

/**
 * The jobs table.
 *
 * Fifty rows, server-side, always. The old Admin page pulled all ~5,231 jobs
 * uncached on every mount — roughly 14 MB — because the table filtered and
 * sorted in the browser. There is no code path here that can fetch more than a
 * page, which is the point: the regression is structurally unavailable rather
 * than merely discouraged.
 */
export default function AdminJobsPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold text-ink">Jobs</h2>

      <Suspense fallback={<Skeleton className="mt-3 h-96 w-full rounded-lg" />}>
        <Table searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Table({ searchParams }: { searchParams: SearchParams }) {
  const { page, status, q } = await searchParams;

  const result = await listJobsForAdmin({
    page: Number(page ?? 1),
    status: asJobStatus(status),
    query: q,
  });

  return (
    <>
      <div className="mt-3 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[40rem] table-fixed text-sm">
          <thead className="bg-surface-2 text-2xs tracking-wide text-ink-3 uppercase">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Title
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Status
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Closes
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Updated
              </th>
            </tr>
          </thead>
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
                <td className="px-3 py-2">
                  <Badge tone={job.status === "published" ? "good" : "neutral"}>
                    {job.status}
                  </Badge>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-ink-2 tabular">
                  {formatDate(job.last_date) ?? "—"}
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-ink-3 tabular">
                  {formatDate(job.updated_at) ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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
