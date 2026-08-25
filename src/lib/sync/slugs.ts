import "server-only";

import { adminDb } from "@/lib/db/clients";

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
 */
export async function uniqueSlugs(
  table: "jobs" | "exam_updates",
  bases: string[],
): Promise<string[]> {
  const db = adminDb();

  const { data, error } = await db
    .from(table)
    .select("slug")
    .in("slug", bases)
    .limit(Math.max(bases.length, 1));

  if (error) throw new Error(`uniqueSlugs(${table}): ${error.message}`);

  const taken = new Set(data.map((r) => r.slug));

  return bases.map((base) => {
    // An empty base would produce "/jobs/" — fall back to something
    // addressable rather than writing a row nobody can reach.
    const stem = base || (table === "jobs" ? "job" : "update");
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
