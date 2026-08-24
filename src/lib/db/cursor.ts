import { z } from "zod";

/**
 * Keyset pagination cursors.
 *
 * `OFFSET` makes page N cost proportional to N — the database walks and
 * discards every preceding row — which is why deep pages were the queries that
 * timed out on the old project. A keyset cursor carries the sort key of the
 * last row seen, so page 200 costs exactly what page 1 costs. Measured on
 * 6,000 rows: 4 shared buffers either way.
 *
 * The cursor is opaque to the client on purpose. It appears in URLs, and an
 * obviously-editable `?after=2026-01-01` invites people to hand-craft one; an
 * opaque token makes the contract clear and lets the encoding change later
 * without breaking every saved link.
 */

const cursorSchema = z.object({
  /** Sort key of the last row on the previous page. */
  k: z.string().min(1),
  /** That row's id, breaking ties on identical sort keys. */
  i: z.uuid(),
});

export interface Cursor {
  sortKey: string;
  id: string;
}

export function encodeCursor(cursor: Cursor): string {
  const json = JSON.stringify({ k: cursor.sortKey, i: cursor.id });
  return Buffer.from(json, "utf8").toString("base64url");
}

/**
 * Returns null for anything unusable, which the caller reads as "start at the
 * first page".
 *
 * Deliberately not an error. Cursors live in URLs, so they get shared, bookmarked
 * and truncated by chat clients; a stale one is an ordinary event, not an
 * attack. Failing the whole page for it would turn a shrug into a 500. A cursor
 * cannot widen access either — RLS still applies to every row it selects — so
 * there is nothing to defend by being strict.
 */
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null;

  try {
    const json: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const parsed = cursorSchema.safeParse(json);
    if (!parsed.success) return null;
    return { sortKey: parsed.data.k, id: parsed.data.i };
  } catch {
    return null;
  }
}

/** One page of results, plus the cursor that fetches the next. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Builds a page from a slice fetched with `limit + 1` rows.
 *
 * Requesting one extra row is how "is there a next page?" gets answered without
 * a second `count(*)` — which on a filtered table means scanning every matching
 * row purely to render a chevron.
 */
export function toPage<T>(
  rows: T[],
  limit: number,
  sortKeyOf: (row: T) => { sortKey: string | null; id: string },
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);

  if (!hasMore || !last) return { items, nextCursor: null };

  const { sortKey, id } = sortKeyOf(last);
  // A null sort key cannot be resumed from, so the page honestly ends here
  // rather than emitting a cursor that would silently restart from the top.
  if (sortKey === null) return { items, nextCursor: null };

  return { items, nextCursor: encodeCursor({ sortKey, id }) };
}

/** Page sizes. Exported so the budget test can assert nothing exceeds them. */
export const PAGE_SIZE = {
  /** Job and update lists. 20 cards is ~11 kB of JSON. */
  list: 20,
  /** Rails and "related" strips. */
  rail: 12,
  /** Admin tables — larger, but still bounded. */
  admin: 50,
} as const;

export const MAX_PAGE_SIZE = 100;

/** Clamps a caller-supplied page size. A URL is not a trusted input. */
export function clampLimit(requested: number | undefined, fallback: number): number {
  if (requested === undefined || !Number.isFinite(requested)) return fallback;
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_PAGE_SIZE);
}
