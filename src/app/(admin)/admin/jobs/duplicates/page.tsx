import Link from "next/link";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { mergeDuplicatesAction } from "@/lib/admin/actions";
import { listDuplicateGroups } from "@/lib/db/queries/admin-jobs";
import { formatDate } from "@/lib/format/deadline";
import { ActionForm } from "../../action-form";
import { Pager } from "../../pager";
import { Empty, Section, Stat, StatRow } from "../../ui";

type SearchParams = Promise<{ page?: string }>;

/**
 * The duplicate finder.
 *
 * `dedupe_key` is `sha256(source_url + title)`, so the same recruitment
 * notification scraped from an organisation's own site and from an aggregator
 * earns two keys and two rows. Ingestion is right to keep them apart — an
 * edited listing on one source must not be confused with an unrelated one on
 * another — so the collapsing happens afterwards, here.
 *
 * This preview and the Merge button share their grouping and their survivor
 * ranking in SQL (0034 mirrors 0027/0028). That is deliberate: a preview
 * computed differently from the operation it previews is a page that lies about
 * its own button.
 */
export default function AdminDuplicatesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mt-6">
      <p className="mb-4 text-xs">
        <Link href="/admin/jobs" className="text-ink-3 hover:text-ink hover:underline">
          ← Jobs
        </Link>
      </p>

      <Section
        title="Duplicate listings"
        hint="Grouped by organisation and title, exactly as the merge groups them. The row marked Keep is the one that survives."
      >
        <Suspense fallback={<Skeleton className="mt-3 h-96 w-full rounded-lg" />}>
          <Groups searchParams={searchParams} />
        </Suspense>
      </Section>
    </div>
  );
}

async function Groups({ searchParams }: { searchParams: SearchParams }) {
  const { page } = await searchParams;
  const result = await listDuplicateGroups(Number(page ?? 1));
  const empty = result.groups.length === 0;

  return (
    <>
      <StatRow>
        <Stat label="Groups" value={result.totalGroups} tone="warn" />
        <Stat label="Listings involved" value={result.totalRows} />
        <Stat
          label="Would be removed"
          value={result.totalRows - result.totalGroups}
          hint="One survivor per group"
          tone="warn"
        />
      </StatRow>

      <div className="mt-4">
        {/* Kept mounted once the table empties — see `canSubmit` in ActionForm.
            The merge revalidates this page to zero groups, and a form that
            unmounted there would throw away the "Merged 3,912 listings" that is
            the only evidence the button did anything. */}
        <ActionForm
          action={mergeDuplicatesAction}
          submitLabel="Merge all duplicate groups"
          pendingLabel="Merging…"
          variant="primary"
          canSubmit={!empty}
        >
          {/*
            Merge, not delete, and there is no per-row delete button anywhere on
            this page. A duplicate row can be somebody's saved job, tracked exam
            or calendar reminder, and `on delete cascade` would take all three
            with it. `merge_duplicate_jobs()` reassigns every referencing table
            to the survivor first — a delete button beside it would be the same
            operation minus the part that protects people.
          */}
          <p className="mb-2 max-w-prose text-xs text-ink-3">
            Merges every group in the table, not just this page. Saved jobs, tracker entries and
            calendar reminders pointing at a removed row are moved to the survivor first, so
            nobody loses anything they saved. Idempotent — running it twice is harmless.
          </p>
        </ActionForm>
      </div>

      {empty ? (
        <Empty>No duplicate groups. Every listing is unique within its organisation.</Empty>
      ) : (
        <>
          <div className="mt-5 flex flex-col gap-4">
            {result.groups.map((group) => (
              <div key={group.key} className="rounded-lg border border-line">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line bg-surface-2 px-3 py-2">
                  <span className="min-w-0 truncate text-sm font-medium text-ink">
                    {group.title}
                  </span>
                  <span className="shrink-0 text-2xs text-ink-3">
                    {group.orgName ?? "no organisation"} · {group.jobs.length} listings
                  </span>
                </div>

                <ul className="divide-y divide-line/60">
                  {group.jobs.map((job) => (
                    <li
                      key={job.jobId}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
                    >
                      <Badge tone={job.isCanonical ? "good" : "neutral"}>
                        {job.isCanonical ? "Keep" : "Merge away"}
                      </Badge>

                      <Link
                        href={`/jobs/${job.slug}`}
                        className="min-w-0 flex-1 truncate text-xs text-ink-2 hover:text-accent hover:underline"
                      >
                        {job.sourceUrl ?? job.slug}
                      </Link>

                      <span className="shrink-0 text-2xs text-ink-3 tabular">
                        closes {formatDate(job.lastDate) ?? "—"} · added{" "}
                        {formatDate(job.createdAt) ?? "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <Pager
            page={result.page}
            pageCount={result.pageCount}
            total={result.totalGroups}
            basePath="/admin/jobs/duplicates"
            params={{}}
          />
        </>
      )}
    </>
  );
}
