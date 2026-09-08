import "server-only";

import { adminDb } from "@/lib/db/clients";
import { chunkForFilter, selectIn } from "@/lib/db/select-in";

/**
 * Makes a batch of base slugs unique, against both the database and each other.
 *
 * One query for the whole batch rather than one per row. The suffix is a
 * counter rather than a hash because these end up in URLs people read, and
 * `ssc-cgl-2026-2` is a better thing to share than `ssc-cgl-2026-a3f9c1`.
 *
 * Shared by both ingest paths. It was private to the jobs worker, and copying
 * it for exam updates would have produced two slug generators that agree today
 * and diverge the first time one of them is fixed.
 *
 * ## Why the second query
 *
 * Asking only `slug IN (bases)` reads the base but not the suffixed rows a
 * previous run already wrote. With `ssc-cgl-2026` and `ssc-cgl-2026-2` both in
 * the table, `taken` held just the first, the counter stopped at 2, and the
 * insert hit `exam_updates_slug_key` — which is thrown, so the whole batch was
 * lost, not the one row. That is what failed ten exam-update runs between
 * 2026-09-01 and 2026-09-03, and 115 rows now carry a `-2` for it to trip over.
 *
 * The prefix scan is the fix, and it runs only over the bases that can actually
 * need a suffix — not at all when nothing collides, which is the usual case for
 * a run carrying a handful of rows. A blanket `LIKE` per base would cost the
 * same read budget every run to learn nothing.
 */
export async function uniqueSlugs(
  table: "jobs" | "exam_updates",
  bases: string[],
): Promise<string[]> {
  const db = adminDb();

  const stems = bases.map((base) => base || (table === "jobs" ? "job" : "update"));

  // `selectIn` splits this by URL length rather than by count, which matters
  // more here than anywhere else on the ingest path: a slug is up to 80
  // characters, so a list of them reaches the limit four times sooner than the
  // same number of dedupe keys.
  const { data: existing, error } = await selectIn(stems, (chunk) =>
    db.from(table).select("slug").in("slug", chunk).limit(chunk.length),
  );

  if (error) throw new Error(`uniqueSlugs(${table}): ${error.message}`);

  const taken = new Set(existing.map((row) => row.slug));

  // The stems whose suffixed siblings are worth reading: the ones the database
  // already holds, plus the ones this batch repeats.
  //
  // The second half is not a nicety. `toSlug` truncates at 80 characters, so
  // two differently-titled listings routinely arrive with the same stem — and
  // the second of them needs `stem-2` even though `stem` itself is free. Only
  // asking about stems the database already has left that case reading nothing
  // and handing out a `-2` a previous run had written.
  const repeats = new Map<string, number>();
  for (const stem of stems) repeats.set(stem, (repeats.get(stem) ?? 0) + 1);

  const contested = [...new Set(stems)].filter(
    (stem) => taken.has(stem) || (repeats.get(stem) ?? 0) > 1,
  );

  // `or` is a query-string filter like `in` is, so it has the same URL ceiling
  // and is split the same way — on the patterns rather than the stems, since
  // the pattern is what actually goes into the request.
  //
  // `toSlug` emits `[a-z0-9-]` only, so no stem can carry a comma, a dot or a
  // parenthesis — the characters that would otherwise need escaping here.
  for (const chunk of chunkForFilter(contested.map((stem) => `slug.like.${stem}-*`))) {
    const { data: suffixed, error: prefixError } = await db
      .from(table)
      .select("slug")
      .or(chunk.join(","));

    if (prefixError) throw new Error(`uniqueSlugs(${table}): ${prefixError.message}`);

    for (const row of suffixed) taken.add(row.slug);
  }

  return stems.map((stem) => {
    // An empty base would produce "/jobs/" — `stems` already fell back to
    // something addressable rather than writing a row nobody can reach.
    let candidate = stem;
    let n = 1;
    while (taken.has(candidate)) {
      n += 1;
      candidate = `${stem}-${String(n)}`;
    }
    taken.add(candidate);
    return candidate;
  });
}
