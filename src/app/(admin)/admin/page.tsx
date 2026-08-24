import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getAdminCounts,
  listDeadLetter,
  listSyncRuns,
  type SyncRunRow,
} from "@/lib/db/queries/admin";
import { formatDateTime } from "@/lib/format/deadline";

export const metadata = { title: "Overview" };

export default function AdminOverviewPage() {
  return (
    <div className="mt-6 flex flex-col gap-8">
      <Suspense fallback={<Skeleton className="h-24 w-full rounded-lg" />}>
        <Counts />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-64 w-full rounded-lg" />}>
        <IngestMonitor />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-32 w-full rounded-lg" />}>
        <DeadLetter />
      </Suspense>
    </div>
  );
}

async function Counts() {
  const counts = await getAdminCounts();

  return (
    <section>
      <h2 className="text-sm font-semibold text-ink">At a glance</h2>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Jobs" value={counts.jobs} />
        <Stat label="Drafts" value={counts.draftJobs} />
        <Stat label="Updates" value={counts.updates} />
        <Stat label="Unlinked updates" value={counts.unlinkedUpdates} tone="warn" />
        <Stat label="Dead letter" value={counts.openDeadLetter} tone="critical" />
      </dl>
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn" | "critical";
}) {
  // Only a non-zero problem gets a colour. A permanently red "0 dead letter"
  // trains everyone to ignore the colour by the second week.
  const alarmed = tone !== undefined && value > 0;

  return (
    <div className="min-w-0 rounded-lg border border-line bg-surface p-3">
      <dt className="truncate text-2xs font-medium tracking-wide text-ink-3 uppercase">
        {label}
      </dt>
      <dd
        className={[
          "mt-1 text-xl font-semibold tabular",
          alarmed && tone === "critical" ? "text-critical" : "",
          alarmed && tone === "warn" ? "text-warn" : "",
          alarmed ? "" : "text-ink",
        ].join(" ")}
      >
        {value.toLocaleString("en-IN")}
      </dd>
    </div>
  );
}

async function IngestMonitor() {
  const runs = await listSyncRuns(20);

  return (
    <section>
      <h2 className="text-sm font-semibold text-ink">Recent ingest runs</h2>

      {runs.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line px-4 py-8 text-center text-sm text-ink-3">
          No runs recorded yet. The worker lands in Module 11.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg border border-line">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="bg-surface-2 text-2xs tracking-wide text-ink-3 uppercase">
              <tr>
                <Th>Kind</Th>
                <Th>Status</Th>
                <Th align="right">Seen</Th>
                <Th align="right">Ins</Th>
                <Th align="right">Upd</Th>
                <Th align="right">Unchanged</Th>
                <Th align="right">Failed</Th>
                <Th align="right">Took</Th>
                <Th>Started</Th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <RunRow key={run.id} run={run} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RunRow({ run }: { run: SyncRunRow }) {
  const tone =
    run.status === "succeeded"
      ? "good"
      : run.status === "failed"
        ? "critical"
        : run.status === "partial"
          ? "warn"
          : "neutral";

  return (
    <tr className="border-t border-line/60">
      <Td>{run.kind}</Td>
      <Td>
        <Badge tone={tone}>{run.status}</Badge>
      </Td>
      <Td align="right">{run.rows_seen}</Td>
      <Td align="right">{run.rows_inserted}</Td>
      <Td align="right">{run.rows_updated}</Td>
      {/* The number that matters for the Module 11 gate: a re-run over
          unchanged data should be almost entirely this column. */}
      <Td align="right" className="font-medium text-ink">
        {run.rows_unchanged}
      </Td>
      <Td align="right" className={run.rows_failed > 0 ? "text-critical" : ""}>
        {run.rows_failed}
      </Td>
      <Td align="right">{run.duration_ms === null ? "—" : `${String(run.duration_ms)}ms`}</Td>
      <Td className="whitespace-nowrap text-ink-3">{formatDateTime(run.started_at)}</Td>
    </tr>
  );
}

async function DeadLetter() {
  const rows = await listDeadLetter(20);

  return (
    <section>
      <h2 className="text-sm font-semibold text-ink">Dead letter</h2>
      <p className="mt-0.5 text-xs text-ink-3">
        Rows that failed to ingest. They sit here instead of stalling the batch, so nothing
        needs manual requeueing.
      </p>

      {rows.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-ink-3">
          Empty. Nothing has failed.
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.id} className="rounded-lg border border-critical/30 bg-critical/5 p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-sm font-medium text-ink">
                  {row.source_key ?? row.kind}
                </span>
                <span className="shrink-0 text-2xs text-ink-3">
                  {String(row.attempts)} attempt{row.attempts === 1 ? "" : "s"}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-critical">{row.error}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Th({ children, align }: { children: React.ReactNode; align?: "right" }) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 font-medium ${align === "right" ? "text-right" : "text-left"}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align,
  className = "",
}: {
  children: React.ReactNode;
  align?: "right";
  className?: string;
}) {
  return (
    <td
      className={`px-3 py-2 tabular ${align === "right" ? "text-right" : "text-left"} ${className}`}
    >
      {children}
    </td>
  );
}
