import Link from "next/link";
import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { asLinkState, listUpdatesForAdmin } from "@/lib/db/queries/admin";
import { formatDate } from "@/lib/format/deadline";
import { CATEGORY_LABELS } from "@/lib/updates/categories";
import { Pager } from "../pager";

type SearchParams = Promise<{ page?: string; link?: string }>;

const LINK_FILTERS = [
  { label: "All", value: undefined },
  { label: "Ambiguous", value: "ambiguous" },
  { label: "Unresolved", value: "unresolved" },
  { label: "Linked", value: "linked" },
  { label: "No match", value: "no_match" },
];

/**
 * The updates table, filtered by link state.
 *
 * "Ambiguous" is the filter that earns this page: those are rows the resolver
 * deliberately refused to guess at, and a human deciding between two candidates
 * is the only thing that can clear them. Without somewhere to see them they
 * would accumulate silently, which is how the old project ended up with the
 * link populated on 3 rows out of 3,373.
 */
export default function AdminUpdatesPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold text-ink">Updates</h2>

      <Suspense fallback={<div className="h-7" />}>
        <Filters searchParams={searchParams} />
      </Suspense>

      <Suspense fallback={<Skeleton className="mt-3 h-96 w-full rounded-lg" />}>
        <Table searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Filters({ searchParams }: { searchParams: SearchParams }) {
  const { link } = await searchParams;

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {LINK_FILTERS.map((filter) => {
        const active = filter.value === link || (!filter.value && !link);
        return (
          <Link
            key={filter.label}
            href={filter.value ? `/admin/updates?link=${filter.value}` : "/admin/updates"}
            aria-current={active ? "page" : undefined}
            className={[
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              active
                ? "border-accent bg-accent/10 text-accent"
                : "border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink",
            ].join(" ")}
          >
            {filter.label}
          </Link>
        );
      })}
    </div>
  );
}

async function Table({ searchParams }: { searchParams: SearchParams }) {
  const { page, link } = await searchParams;

  const result = await listUpdatesForAdmin({
    page: Number(page ?? 1),
    linkState: asLinkState(link),
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
                Type
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Job link
              </th>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Published
              </th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((update) => (
              <tr key={update.id} className="border-t border-line/60">
                <td className="max-w-0 px-3 py-2">
                  <Link
                    href={`/updates/${update.slug}`}
                    className="block truncate font-medium text-ink hover:text-accent hover:underline"
                  >
                    {update.title}
                  </Link>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-ink-2">
                  {CATEGORY_LABELS[update.category]}
                </td>
                <td className="px-3 py-2">
                  <Badge
                    tone={
                      update.job_link_state === "linked"
                        ? "good"
                        : update.job_link_state === "ambiguous"
                          ? "warn"
                          : "neutral"
                    }
                  >
                    {update.job_link_state}
                  </Badge>
                </td>
                <td className="px-3 py-2 whitespace-nowrap text-ink-3 tabular">
                  {formatDate(update.published_date) ?? "—"}
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
        basePath="/admin/updates"
        params={{ link }}
      />
    </>
  );
}
