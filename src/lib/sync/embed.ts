import "server-only";

/**
 * Embedding backfill for jobs.
 *
 * After the sync worker writes new or changed rows, some of them have
 * `embedding IS NULL`. This module finds those rows, generates their vectors
 * from the Gemini embedding API, and writes them back.
 *
 * Design properties that matter:
 *
 *   **Idempotent.** Only touches `embedding IS NULL` rows. Running twice
 *   over the same data writes nothing the second time. This is the same
 *   property `ingestJobs` has for the same reason: the sync trigger can fire
 *   more than once, and the second run must cost nothing.
 *
 *   **Incremental.** Processes a bounded batch per call, not the whole table.
 *   A sync with 12 new jobs embeds 12 rows; the first deploy after enabling
 *   this catches up over a few days at 50 rows per run, which is fine — a
 *   feature that needs 5,000 rows before it helps is a feature that helps
 *   nobody until Thursday, and a feature that helps on 50 is better today.
 *
 *   **Non-blocking.** Failure here does not fail the sync. A job without an
 *   embedding still renders, still appears in search, still matches via the
 *   rule-based engine. The embedding is a secondary signal for similarity,
 *   not a prerequisite for anything.
 */

import { adminDb } from "@/lib/db/clients";
import { embedTexts, canEmbed } from "@/lib/ai/gemini-embed";

/* ── Configuration ─────────────────────────────────────────────────────── */

/**
 * The text that becomes a vector.
 *
 * Title + qualification + location gives the embedding enough to measure
 * "is this the same kind of job, in the same area?" — which is what
 * "similar jobs" and profile-to-job similarity need. Adding the full
 * description would give more signal and much more noise; the card-level
 * fields are the signal a reader uses to decide in the first place.
 */
function composeText(row: {
  title: string;
  qualification_summary: string | null;
  location: string | null;
  state: string | null;
}): string {
  return [row.title, row.qualification_summary, row.location, row.state]
    .filter(Boolean)
    .join(" | ");
}

/* ── Types ─────────────────────────────────────────────────────────────── */

export interface EmbedResult {
  processed: number;
  failed: number;
  skipped: number;
}

/* ── The job ───────────────────────────────────────────────────────────── */

/**
 * Generate embeddings for published jobs that do not have one.
 *
 * Called after `ingestJobs`, inside the same request. The `limit` parameter
 * caps how many rows a single call processes — 50 is one Gemini batch call
 * and takes ~1-3s, well within the remaining time of a 60s function.
 *
 * Returns counts for observability. Throws nothing: failures are logged and
 * the counts say what happened.
 */
export async function embedNewJobs(limit = 50): Promise<EmbedResult> {
  const result: EmbedResult = { processed: 0, failed: 0, skipped: 0 };

  // No keys → nothing to do. Logged once here rather than on every failed
  // attempt, which is how `gemini.ts` handles the same case.
  if (!(await canEmbed())) {
    console.warn("[embed] no API keys configured; skipping embedding generation");
    return result;
  }

  const db = adminDb();

  // ── 1. Find rows that need embeddings ─────────────────────────────────
  const { data: rows, error: readError } = await db
    .from("jobs")
    .select("id, title, qualification_summary, location, state")
    .eq("status", "published")
    .is("embedding", null)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (readError) {
    console.error("[embed] could not read jobs:", readError.message);
    result.failed = 1;
    return result;
  }

  if (rows.length === 0) {
    return result;
  }

  // ── 2. Compose texts ──────────────────────────────────────────────────
  const texts = rows.map((row) => composeText(row));

  // ── 3. Call Gemini ────────────────────────────────────────────────────
  let vectors: number[][];
  try {
    vectors = await embedTexts(texts);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[embed] Gemini embedding call failed:", message);
    result.failed = rows.length;
    return result;
  }

  // ── 4. Write back ─────────────────────────────────────────────────────
  // Individual updates rather than a bulk, because a garbled vector on one
  // row must not block the other 49. The same per-row-failure pattern as
  // `ingestJobs` updates, for the same reason.
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const vector = vectors[i];
    if (!row || !vector) {
      result.skipped += 1;
      continue;
    }

    // Supabase/PostgREST accepts vectors as a JSON string of the array.
    const { error } = await db
      .from("jobs")
      .update({ embedding: JSON.stringify(vector) })
      .eq("id", row.id);

    if (error) {
      console.error(`[embed] failed to write embedding for ${row.id}:`, error.message);
      result.failed += 1;
    } else {
      result.processed += 1;
    }
  }

  if (result.processed > 0) {
    console.warn(`[embed] generated ${String(result.processed)} embeddings`);
  }

  return result;
}
