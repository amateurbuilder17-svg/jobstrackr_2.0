import "server-only";

import { adminDb } from "@/lib/db/clients";
import { toSlug } from "./normalize";

/**
 * Maps organisation names in a batch to ids, creating any that are new.
 *
 * The feed carries a body's name, not its id, and a name that does not exist
 * yet is normal — a new recruiting body appears every few weeks. Creating it is
 * better than dead-lettering every job it posts, which is what refusing would
 * amount to.
 *
 * Matched case-insensitively on the generated slug rather than on the name, so
 * "Staff Selection Commission" and "staff selection commission" are one body
 * rather than two.
 */
export async function resolveOrganizations(
  rawNames: (string | null | undefined)[],
): Promise<Map<string, string>> {
  const db = adminDb();

  const names = new Map<string, string>(); // slug → original name
  for (const name of rawNames) {
    if (!name) continue;
    const slug = toSlug(name);
    if (slug) names.set(slug, name);
  }

  const out = new Map<string, string>(); // name → id
  if (names.size === 0) return out;

  const { data: existing, error } = await db
    .from("organizations")
    .select("id, slug")
    .in("slug", [...names.keys()]);

  if (error) throw new Error(`resolveOrganizations: ${error.message}`);

  const bySlug = new Map(existing.map((o) => [o.slug, o.id]));

  const missing = [...names.entries()].filter(([slug]) => !bySlug.has(slug));

  if (missing.length > 0) {
    const { data: created, error: createError } = await db
      .from("organizations")
      .insert(missing.map(([slug, name]) => ({ slug, name })))
      .select("id, slug");

    if (createError) throw new Error(`resolveOrganizations: ${createError.message}`);
    for (const o of created) bySlug.set(o.slug, o.id);
  }

  for (const [slug, name] of names) {
    const id = bySlug.get(slug);
    if (id) out.set(name, id);
  }
  return out;
}
