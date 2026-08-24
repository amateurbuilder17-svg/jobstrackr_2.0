import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { getTableStats } from "@/lib/db/queries/admin";

export default function AdminEgressPage() {
  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold text-ink">Storage and row width</h2>

      {/*
        Deliberately not titled "egress". Actual egress is a billing metric and
        is not queryable from inside the database, so a page claiming to measure
        it would be lying about its own numbers. What is shown is what *drives*
        egress: how wide a row is and how many of them a query can reach. The
        old project's bill came from a 6 kB row multiplied by 5,231 rows
        multiplied by every page view — all three of those are visible here.
      */}
      <p className="mt-1 max-w-prose text-xs text-ink-3">
        These are storage figures, not billed egress — that number lives in the Supabase
        dashboard. They are here because row width times rows reached is what the bill is made
        of. Bytes per row includes indexes and TOAST, so it overstates small tables.
      </p>

      <Suspense fallback={<Skeleton className="mt-4 h-80 w-full rounded-lg" />}>
        <Table />
      </Suspense>
    </div>
  );
}

async function Table() {
  const stats = await getTableStats();
  const totalBytes = stats.reduce((sum, row) => sum + row.total_bytes, 0);

  return (
    <>
      <div className="mt-4 overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="bg-surface-2 text-2xs tracking-wide text-ink-3 uppercase">
            <tr>
              <th scope="col" className="px-3 py-2 text-left font-medium">
                Table
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Rows
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Total
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Per row
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.map((row) => (
              <tr key={row.table_name} className="border-t border-line/60">
                <td className="px-3 py-2 font-medium text-ink">{row.table_name}</td>
                <td className="px-3 py-2 text-right text-ink-2 tabular">
                  {row.row_estimate.toLocaleString("en-IN")}
                </td>
                <td className="px-3 py-2 text-right text-ink-2 tabular">
                  {formatBytes(row.total_bytes)}
                </td>
                <td
                  className={[
                    "px-3 py-2 text-right tabular",
                    // 6 kB per row is what the old jobs table cost and the
                    // number this rebuild set out to beat — but only flag it
                    // where it means something. Below a few hundred rows the
                    // figure is mostly fixed index and page overhead divided by
                    // a tiny denominator: a 2-row table reads as "40 kB per
                    // row" and is not a problem. Colouring those red is how a
                    // dashboard teaches people to ignore its own warnings.
                    isMeaningful(row) && row.bytes_per_row > 6000
                      ? "font-medium text-critical"
                      : "text-ink-3",
                  ].join(" ")}
                >
                  {isMeaningful(row) ? formatBytes(row.bytes_per_row) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-ink-3 tabular">
        {formatBytes(totalBytes)} across {stats.length} tables. Supabase free tier allows 500
        MB.
      </p>
    </>
  );
}

/**
 * Whether per-row size is worth reporting at all. Under this many rows the
 * number is overhead, not row width.
 */
function isMeaningful(row: { row_estimate: number }): boolean {
  return row.row_estimate >= 100;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
