import Link from "next/link";

/**
 * Page links for the admin tables.
 *
 * Links, not buttons: an admin table is something you share ("row 412 is
 * wrong"), bookmark, and reach with the back button. Client-side state would
 * lose all three, and the page is server-rendered anyway.
 */
export function Pager({
  page,
  pageCount,
  total,
  basePath,
  params,
}: {
  page: number;
  pageCount: number;
  total: number;
  basePath: string;
  /** Current filters, so paging does not silently clear them. */
  params: Record<string, string | undefined>;
}) {
  const href = (target: number) => {
    const next = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) next.set(key, value);
    }
    if (target > 1) next.set("page", String(target));
    const qs = next.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };

  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-sm">
      <p className="text-xs text-ink-3 tabular">
        Page {page} of {pageCount} · {total.toLocaleString("en-IN")} rows
      </p>

      <div className="flex gap-1">
        {page > 1 ? (
          <Link href={href(page - 1)} className={LINK} rel="prev">
            Previous
          </Link>
        ) : (
          <span className={DISABLED}>Previous</span>
        )}

        {page < pageCount ? (
          <Link href={href(page + 1)} className={LINK} rel="next">
            Next
          </Link>
        ) : (
          <span className={DISABLED}>Next</span>
        )}
      </div>
    </div>
  );
}

const LINK =
  "rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-ink " +
  "transition-colors hover:border-line-strong hover:bg-surface-2";

const DISABLED =
  "rounded-md border border-line/60 px-3 py-1.5 text-xs font-medium text-ink-3/60";
