import { Suspense } from "react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveUpdateLinksAction, saveSourceAction } from "@/lib/admin/actions";
import { getSourceHealth, getSyncByDay } from "@/lib/db/queries/admin-ops";
import { listSyncRuns } from "@/lib/db/queries/admin";
import { formatDateTime } from "@/lib/format/deadline";
import { ActionForm, RowAction } from "../action-form";
import { toggleSourceAction } from "@/lib/admin/actions";
import { Empty, Section, since, Stat, StatRow, Td, TableFrame, Th, THead } from "../ui";

/**
 * Discover — where content comes from, and whether it is still arriving.
 *
 * This is the page that differs most from the old admin's tab of the same name,
 * so it is worth being direct about what changed and why.
 *
 * The old Discover drove the scrape from the browser: load a listing page, then
 * one fetch per article, then one insert per article, with a "Scrape All"
 * button that could fire two hundred serverless invocations from a single
 * click. It worked, and it is one of the reasons the old project's bill looked
 * the way it did. Nothing about that shape survives contact with a Hobby plan —
 * not the invocation count, not the function duration, not the write
 * amplification of inserting rows one at a time from a laptop that might close.
 *
 * Ingestion here is a scheduled worker (`/api/sync`) that diffs a whole feed in
 * one request and writes only what changed. So the browser's job is no longer
 * to *do* the scraping — it is to say which sources should be scraped, and to
 * show whether they are still landing rows. That is what this page is.
 *
 * The number worth watching is `unchanged` in the daily table. A healthy re-run
 * over a feed that has not moved should be almost entirely unchanged rows: that
 * is the diff working, and it is what keeps a frequent schedule affordable.
 */
export default function AdminDiscoverPage() {
  return (
    <div className="mt-6 flex flex-col gap-8">
      <Suspense fallback={<Skeleton className="h-64 w-full rounded-lg" />}>
        <Sources />
      </Suspense>

      <AddSource />

      <Suspense fallback={<Skeleton className="h-64 w-full rounded-lg" />}>
        <ByDay />
      </Suspense>

      <Suspense fallback={<Skeleton className="h-48 w-full rounded-lg" />}>
        <Runs />
      </Suspense>

      <Section
        title="Link updates to jobs"
        hint="Runs on a schedule. Ambiguous rows are the ones the resolver refused to guess at — they are the only pile that does not shrink on its own."
      >
        <div className="mt-3">
          <ActionForm
            action={resolveUpdateLinksAction}
            submitLabel="Resolve update links now"
            pendingLabel="Resolving…"
          />
        </div>
      </Section>
    </div>
  );
}

async function Sources() {
  const sources = await getSourceHealth();
  const active = sources.filter((source) => source.isActive);
  const quiet = active.filter((source) => source.rowsLast7Days === 0);

  return (
    <Section
      title="Sources"
      hint="Rows are attributed by host against each update's own source URL — a relationship the data actually carries, unlike a join on the feed name."
    >
      <StatRow>
        <Stat label="Sources" value={sources.length} />
        <Stat label="Active" value={active.length} />
        <Stat
          label="Silent 7 days"
          value={quiet.length}
          tone="warn"
          hint={quiet.length > 0 ? "active but landing nothing" : undefined}
        />
        <Stat
          label="Rows this week"
          value={sources.reduce((sum, source) => sum + source.rowsLast7Days, 0)}
        />
      </StatRow>

      {sources.length === 0 ? (
        <Empty>No sources configured. Add one below.</Empty>
      ) : (
        <TableFrame minWidth="52rem">
          <THead>
            <Th>Source</Th>
            <Th width="8rem">Category</Th>
            <Th align="right" width="6rem">
              7 days
            </Th>
            <Th align="right" width="6rem">
              Total
            </Th>
            <Th width="7rem">Last row</Th>
            <Th width="6rem">Per run</Th>
            <Th width="7rem">
              <span className="sr-only">Actions</span>
            </Th>
          </THead>
          <tbody>
            {sources.map((source) => (
              <tr
                key={source.id}
                className={`border-t border-line/60 ${source.isActive ? "" : "opacity-55"}`}
              >
                <td className="max-w-0 px-3 py-2">
                  <span className="block truncate font-medium text-ink">{source.name}</span>
                  <span className="block truncate text-2xs text-ink-3">{source.url}</span>
                </td>
                <Td>
                  <Badge>{source.category}</Badge>
                </Td>
                <Td
                  align="right"
                  className={
                    source.isActive && source.rowsLast7Days === 0 ? "text-warn" : "text-ink"
                  }
                >
                  {source.rowsLast7Days.toLocaleString("en-IN")}
                </Td>
                <Td align="right" className="text-ink-3">
                  {source.rowsTotal.toLocaleString("en-IN")}
                </Td>
                <Td className="whitespace-nowrap text-ink-3">{since(source.lastRowAt)}</Td>
                <Td align="right" className="text-ink-3">
                  {source.limitPerRun}
                </Td>
                <Td>
                  <div className="flex justify-end">
                    {/*
                      Paused, never deleted. A source row carries its history
                      through every update attributed to its host; deleting it
                      to stop it would throw that away to achieve what a boolean
                      does.
                    */}
                    <RowAction
                      action={toggleSourceAction}
                      fields={{ id: source.id, isActive: String(source.isActive) }}
                      label={source.isActive ? "Pause" : "Resume"}
                    />
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      )}
    </Section>
  );
}

function AddSource() {
  return (
    <Section title="Add a source" hint="Picked up by the next scheduled run.">
      <ActionForm
        action={saveSourceAction}
        submitLabel="Add source"
        pendingLabel="Saving…"
        variant="primary"
        className="mt-3"
      >
        <div className="mb-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className={LABEL}>Name</span>
            <input
              name="name"
              required
              placeholder="FreeJobAlert · new updates"
              className={INPUT}
            />
          </label>

          <div className="sm:col-span-2">
            <label className="block">
              <span className={LABEL}>Listing URL</span>
              <input
                name="url"
                type="url"
                required
                placeholder="https://www.freejobalert.com/new-updates/"
                className={INPUT}
              />
            </label>
          </div>

          <label className="block">
            <span className={LABEL}>Category</span>
            <select name="category" defaultValue="notification" className={INPUT}>
              <option value="notification">notification</option>
              <option value="admit_card">admit_card</option>
              <option value="result">result</option>
              <option value="answer_key">answer_key</option>
              <option value="syllabus">syllabus</option>
              <option value="exam_date">exam_date</option>
              <option value="cutoff">cutoff</option>
              <option value="news">news</option>
            </select>
          </label>

          <label className="block">
            <span className={LABEL}>Rows per run</span>
            <input
              name="limitPerRun"
              type="number"
              min={1}
              max={500}
              defaultValue={50}
              className={INPUT}
            />
          </label>
        </div>
      </ActionForm>
    </Section>
  );
}

async function ByDay() {
  const days = await getSyncByDay(14);

  return (
    <Section
      title="Ingestion by day"
      hint="Unchanged is the column to read: a re-run over a feed that has not moved should be almost entirely unchanged rows. That is the diff working, and it is what makes a frequent schedule affordable."
    >
      {days.length === 0 ? (
        <Empty>No runs in the last fourteen days.</Empty>
      ) : (
        <TableFrame minWidth="46rem">
          <THead>
            <Th width="8rem">Day</Th>
            <Th width="8rem">Feed</Th>
            <Th align="right">Runs</Th>
            <Th align="right">Seen</Th>
            <Th align="right">New</Th>
            <Th align="right">Updated</Th>
            <Th align="right">Unchanged</Th>
            <Th align="right">Failed</Th>
          </THead>
          <tbody>
            {days.map((day) => (
              <tr key={`${day.day}|${day.kind}`} className="border-t border-line/60">
                <Td className="whitespace-nowrap text-ink-2">{day.day}</Td>
                <Td className="text-ink-3">{day.kind}</Td>
                <Td align="right">{day.runs}</Td>
                <Td align="right">{day.seen.toLocaleString("en-IN")}</Td>
                <Td align="right">{day.inserted.toLocaleString("en-IN")}</Td>
                <Td align="right">{day.updated.toLocaleString("en-IN")}</Td>
                <Td align="right" className="font-medium text-ink">
                  {day.unchanged.toLocaleString("en-IN")}
                </Td>
                <Td align="right" className={day.failures > 0 ? "text-critical" : "text-ink-3"}>
                  {day.failures}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      )}
    </Section>
  );
}

async function Runs() {
  const runs = await listSyncRuns(10);

  return (
    <Section title="Last ten runs">
      {runs.length === 0 ? (
        <Empty>Nothing recorded yet.</Empty>
      ) : (
        <TableFrame minWidth="40rem">
          <THead>
            <Th width="8rem">Feed</Th>
            <Th width="7rem">Status</Th>
            <Th align="right">Seen</Th>
            <Th align="right">New</Th>
            <Th align="right">Failed</Th>
            <Th align="right" width="6rem">
              Took
            </Th>
            <Th width="11rem">Started</Th>
          </THead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-t border-line/60">
                <Td className="text-ink-2">{run.kind}</Td>
                <Td>
                  <Badge
                    tone={
                      run.status === "succeeded"
                        ? "good"
                        : run.status === "failed"
                          ? "critical"
                          : run.status === "partial"
                            ? "warn"
                            : "neutral"
                    }
                  >
                    {run.status}
                  </Badge>
                </Td>
                <Td align="right">{run.rows_seen}</Td>
                <Td align="right">{run.rows_inserted}</Td>
                <Td align="right" className={run.rows_failed > 0 ? "text-critical" : ""}>
                  {run.rows_failed}
                </Td>
                <Td align="right" className="text-ink-3">
                  {run.duration_ms === null ? "—" : `${String(run.duration_ms)}ms`}
                </Td>
                <Td className="whitespace-nowrap text-ink-3">
                  {formatDateTime(run.started_at)}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      )}
    </Section>
  );
}

const LABEL = "block text-2xs font-medium tracking-wide text-ink-3 uppercase mb-1";
const INPUT =
  "h-9 w-full rounded-md border border-line bg-surface px-3 text-sm text-ink " +
  "placeholder:text-ink-3 focus:border-line-strong focus:outline-none";
