import "server-only";

import { adminDb } from "@/lib/db/clients";

/** How many `slug LIKE 'base-%'` patterns to put in one PostgREST `or` filter. */
const PREFIX_CHUNK = 40;

/**
 * How many slugs to put in one `slug IN (…)` query.
 *
 * PostgREST takes its filters in the query string, and a slug is up to 80
 * characters, so this list is the URL. Somewhere between 200 and 400 entries
 * the request stops being a 200 and becomes a bare "Bad Request" with no
 * message — measured against the live project, not guessed. 150 leaves room
 * under that without making the read budget worse in any way that matters: a
 * normal batch is a handful of rows and still costs exactly one query.
 */
const IN_CHUNK = 150;

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

  const taken = new Set<string>();

  for (let i = 0; i < stems.length; i += IN_CHUNK) {
    const chunk = stems.slice(i, i + IN_CHUNK);

    const { data, error } = await db
      .from(table)
      .select("slug")
      .in("slug", chunk)
      .limit(chunk.length);

    if (error) throw new Error(`uniqueSlugs(${table}): ${error.message}`);

    for (const row of data) taken.add(row.slug);
  }

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

  for (let i = 0; i < contested.length; i += PREFIX_CHUNK) {
    const chunk = contested.slice(i, i + PREFIX_CHUNK);
    // `toSlug` emits `[a-z0-9-]` only, so no stem can carry a comma, a dot or a
    // parenthesis — the characters that would otherwise need escaping here.
    const filter = chunk.map((stem) => `slug.like.${stem}-*`).join(",");

    const { data: suffixed, error: prefixError } = await db
      .from(table)
      .select("slug")
      .or(filter);

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
