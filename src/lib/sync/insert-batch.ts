import "server-only";

/**
 * Inserting so that one bad row costs one row.
 *
 * ## The defect this exists to end
 *
 * Postgres evaluates a multi-row `INSERT` as a single statement. One row that
 * violates a constraint aborts the whole statement, so a bulk insert of 149
 * good rows and one bad one writes nothing — and both ingest paths `throw` on
 * that error, which fails the run and loses the other 149 with no dead letter
 * to retry them from. The run row records `rows_seen = 0`, so the evidence
 * does not even say how much was lost.
 *
 * This has stopped ingestion three times, and each fix predicted one more
 * constraint before the rows could reach Postgres:
 *
 *   • `dropIfWrongSideOf` in `ingest.ts` — the ordering CHECKs, after one
 *     transposed date pair stopped ingestion for four days on 2026-08-26.
 *   • `PG_INT_MAX` in `normalize.ts` — the welded application-fee cells, after
 *     85 runs lost their entire batch to ten of them.
 *   • The prefix scan in `uniqueSlugs` — `exam_updates_slug_key`, after ten
 *     exam-update runs died between 2026-09-01 and 2026-09-03.
 *
 * Each is correct and each stays; a row rejected before it reaches the database
 * is still cheaper than one rejected by it. What none of them can be is
 * complete. The next NOT NULL, foreign key, text length or newly-added CHECK is
 * another outage found in production, because prediction is the wrong shape of
 * solution to "the database refused something".
 *
 * ## Isolation instead of prediction
 *
 * Try the batch. If Postgres rejects it, split it and retry the halves. A
 * failing statement writes nothing, so retrying a subset is always safe, and
 * the recursion narrows to exactly the rows the database will not take. Those
 * come back as failures for `sync_dead_letter`; everything else lands.
 *
 * It never asks *which* constraint failed, which is the whole point: it covers
 * the ones nobody has thought of yet.
 *
 * ## What it costs
 *
 * A clean batch costs exactly one statement — the overwhelmingly common case,
 * and the reason this is not simply a per-row loop. Isolating k bad rows out of
 * n costs roughly `k · log₂ n` extra statements: one bad row in 150 is about
 * fifteen, well under a second.
 *
 * Below `linearBelow` rows the split stops paying for itself — bisecting a
 * chunk to isolate all of it costs `2n − 1` statements where a straight loop
 * costs `n` — so small chunks are walked one row at a time.
 */

/** A row the database refused, with the reason it gave. */
export interface IsolatedFailure<Row> {
  row: Row;
  error: string;
}

export interface InsertOutcome<Row> {
  inserted: number;
  failures: IsolatedFailure<Row>[];
  /** Insert statements issued. Worth recording: it is the cost of a bad batch. */
  attempts: number;
}

export interface IsolateOptions {
  /** At or below this many rows, stop splitting and walk them individually. */
  linearBelow?: number;
  /**
   * A ceiling on statements, so a wholly poisoned batch cannot eat the
   * function's wall clock. Rows left unattempted when it is reached are
   * reported as failures rather than silently dropped — a row nobody tried is
   * still a row that did not land, and the dead letter is where that belongs.
   */
  maxAttempts?: number;
}

const DEFAULT_LINEAR_BELOW = 8;

/** Generous enough for the realistic worst case, finite enough to bound the run. */
const defaultMaxAttempts = (rows: number): number => rows * 2 + 16;

export const BUDGET_EXHAUSTED =
  "not attempted: the batch exhausted its failure-isolation budget";

/**
 * Insert `rows`, returning what landed and what the database refused.
 *
 * `insert` is called with a subset and must resolve to Supabase's
 * `{ error }` shape — passing the query builder straight through is the
 * intended use:
 *
 * ```ts
 * await insertIsolatingFailures(rows, (chunk) => db.from("jobs").insert(chunk));
 * ```
 *
 * Chunks are attempted in order, never concurrently. Order is what makes the
 * result deterministic when two rows in the same batch collide with each other:
 * the earlier one lands and the later one is isolated, rather than whichever
 * request happened to arrive first.
 */
export async function insertIsolatingFailures<Row>(
  rows: Row[],
  insert: (chunk: Row[]) => PromiseLike<{ error: { message: string } | null }>,
  options: IsolateOptions = {},
): Promise<InsertOutcome<Row>> {
  const linearBelow = options.linearBelow ?? DEFAULT_LINEAR_BELOW;
  const maxAttempts = options.maxAttempts ?? defaultMaxAttempts(rows.length);

  const outcome: InsertOutcome<Row> = { inserted: 0, failures: [], attempts: 0 };

  if (rows.length === 0) return outcome;

  const isolate = async (chunk: Row[]): Promise<void> => {
    if (chunk.length === 0) return;

    if (outcome.attempts >= maxAttempts) {
      for (const row of chunk) outcome.failures.push({ row, error: BUDGET_EXHAUSTED });
      return;
    }

    outcome.attempts += 1;
    const { error } = await insert(chunk);

    if (error === null) {
      outcome.inserted += chunk.length;
      return;
    }

    // A single row that the database refuses is the row we were looking for.
    const only = chunk[0];
    if (chunk.length === 1 && only !== undefined) {
      outcome.failures.push({ row: only, error: error.message });
      return;
    }

    if (chunk.length <= linearBelow) {
      for (const row of chunk) await isolate([row]);
      return;
    }

    const mid = Math.floor(chunk.length / 2);
    await isolate(chunk.slice(0, mid));
    await isolate(chunk.slice(mid));
  };

  await isolate(rows);

  return outcome;
}
