import "server-only";

/**
 * How many characters of `IN` values one request may carry.
 *
 * PostgREST takes its filters in the query string, so `dedupe_key=in.(…)` *is*
 * the URL, and past a certain length the request never reaches the database —
 * it comes back as a bare "Bad Request" with no message, or as `fetch failed`
 * with no response at all. Neither says anything about lists being too long.
 *
 * Measured against the live project rather than guessed, and the wall tracks
 * total characters rather than the number of values: 440 32-character keys
 * (~14,500 chars) go through and 455 (~15,000) do not, and 200 80-character
 * slugs go through at the same character count where 300 do not. That is a
 * ~16 KB URL limit with the rest of the request making up the difference.
 *
 * 8,000 is a little over half of the smallest failure observed. The headroom is
 * deliberate: this was measured on one project on one day, values are not
 * always as URL-safe as a hex key, and the two costs are not symmetric. Being
 * too conservative spends a few extra reads on the rare large batch; being too
 * generous loses the batch, because these reads sit at the top of ingestion and
 * the error is thrown, not dead-lettered.
 */
const MAX_FILTER_CHARS = 8_000;

/**
 * Splits values so no single `IN` list exceeds the URL budget.
 *
 * Exported for the tests, which is the only way to check the boundary without
 * a network.
 */
export function chunkForFilter(
  values: readonly string[],
  budget = MAX_FILTER_CHARS,
): string[][] {
  const chunks: string[][] = [];
  let chunk: string[] = [];
  let chars = 0;

  for (const value of values) {
    // +1 for the comma PostgREST puts between values.
    const cost = value.length + 1;
    if (chunk.length > 0 && chars + cost > budget) {
      chunks.push(chunk);
      chunk = [];
      chars = 0;
    }
    chunk.push(value);
    chars += cost;
  }

  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

/**
 * One logical `select ... where column in (values)`, sent as as many requests
 * as the URL budget requires, with the rows concatenated.
 *
 * The caller supplies the query, so the columns and their types stay theirs —
 * a helper that built the query itself would have to erase the row type and
 * every call site would lose the checking that catches a renamed column.
 *
 *     const { data, error } = await selectIn(keys, (chunk) =>
 *       db.from("jobs").select("id, dedupe_key, content_hash").in("dedupe_key", chunk),
 *     );
 *
 * The result keeps the shape PostgREST returns, so existing error handling
 * carries over unchanged. The first failing chunk stops the read and is
 * returned — a partial answer here would silently read as "these rows do not
 * exist yet", and ingestion would insert duplicates of rows it already had.
 */
export async function selectIn<Row, Err>(
  values: readonly string[],
  read: (chunk: string[]) => PromiseLike<{ data: Row[] | null; error: Err | null }>,
): Promise<{ data: Row[]; error: Err | null }> {
  const rows: Row[] = [];

  for (const chunk of chunkForFilter(values)) {
    const { data, error } = await read(chunk);
    if (error) return { data: rows, error };
    if (data) rows.push(...data);
  }

  return { data: rows, error: null };
}
