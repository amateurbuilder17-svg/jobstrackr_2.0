import type { SeoUrl } from "./targets";

/**
 * Which of a fetched page of rows may safely be counted as "done".
 *
 * The watermark is a timestamp and the next run asks for `updated_at > it`, so
 * a batch that stops in the middle of a group of rows sharing one timestamp
 * would silently skip the rest of that group forever. That is not a
 * hypothetical: `updated_at` defaults to `now()`, which in Postgres is the
 * *transaction* start time, so a bulk ingest writing 2,000 rows in one
 * statement gives every one of them the identical timestamp.
 *
 * So the caller fetches one more row than it intends to use, and this trims the
 * batch back to the last complete timestamp group.
 *
 * The fallback matters as much as the rule. If a single timestamp group is
 * itself larger than the batch size, trimming leaves nothing and the worker
 * would make no progress on any run, forever — a livelock that looks exactly
 * like "push indexing stopped working" with no error anywhere. In that case the
 * batch is taken whole and the watermark moves past the shared timestamp: some
 * rows from that one bulk write are never pushed, and they are found by the
 * next crawl of the sitemap instead. A partial push beats a permanent stall.
 *
 * @param fetched  rows ordered by `updatedAt` ascending, of length up to limit+1
 * @param limit    how many the caller asked for
 */
export function trimToCompleteBatch(fetched: readonly SeoUrl[], limit: number): SeoUrl[] {
  // Fewer than the caller asked for: the set is exhausted, so there is no row
  // beyond the batch that could share the last timestamp.
  if (fetched.length <= limit) return [...fetched];

  const excluded = fetched[limit];
  const kept = fetched.slice(0, limit);
  const safe = kept.filter((row) => row.updatedAt !== excluded?.updatedAt);

  return safe.length > 0 ? safe : kept;
}

/** The highest `updatedAt` in a batch — the value the watermark moves to. */
export function highestUpdatedAt(rows: readonly SeoUrl[]): string | null {
  return rows.reduce<string | null>(
    (max, row) => (max === null || row.updatedAt > max ? row.updatedAt : max),
    null,
  );
}

/**
 * Merges the job and update streams into one chronological batch.
 *
 * Both are already sorted ascending by their own query, and the watermark is a
 * single timestamp spanning both tables, so the merged order has to be
 * chronological rather than jobs-then-updates: taking all the jobs first would
 * advance the watermark past updates that were never submitted.
 */
export function mergeByUpdatedAt(...streams: readonly SeoUrl[][]): SeoUrl[] {
  return streams.flat().sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}
