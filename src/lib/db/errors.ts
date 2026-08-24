import type { PostgrestError } from "@supabase/supabase-js";

/**
 * A database failure, with enough context to be actionable in a log line.
 *
 * Supabase returns errors as values rather than throwing, which is easy to
 * ignore — `const { data } = await ...` compiles perfectly and silently yields
 * undefined on failure. Every query in this layer routes through `unwrap`, so
 * an error becomes an exception the nearest error boundary can render, and the
 * log says which query failed rather than only that something did.
 */
export class DbError extends Error {
  readonly operation: string;
  readonly code: string | undefined;
  readonly details: string | undefined;
  readonly hint: string | undefined;

  constructor(operation: string, cause: PostgrestError) {
    super(`[db:${operation}] ${cause.message}`);
    this.name = "DbError";
    this.operation = operation;
    this.code = cause.code;
    this.details = cause.details;
    this.hint = cause.hint;
    this.cause = cause;
  }

  /**
   * Statement timeout. On the old project this was the routine symptom of an
   * unbounded scan, so it is worth distinguishing from a generic failure: it
   * almost always means a query lost its LIMIT or an index stopped being used.
   */
  get isTimeout(): boolean {
    return this.code === "57014";
  }

  /**
   * RLS refused the row. Not necessarily a bug — it is the expected result of
   * asking for something that is not yours — so callers may choose to render
   * "not found" rather than an error.
   */
  get isForbidden(): boolean {
    return this.code === "42501" || this.code === "PGRST301";
  }
}

/** Throw on error, return data otherwise. */
export function unwrap<T>(
  operation: string,
  result: { data: T | null; error: PostgrestError | null },
): T {
  if (result.error) throw new DbError(operation, result.error);
  if (result.data === null) {
    throw new Error(`[db:${operation}] returned no data and no error`);
  }
  return result.data;
}

/** As `unwrap`, but a missing row is a legitimate null rather than a failure. */
export function unwrapMaybe<T>(
  operation: string,
  result: { data: T | null; error: PostgrestError | null },
): T | null {
  if (result.error) throw new DbError(operation, result.error);
  return result.data;
}
