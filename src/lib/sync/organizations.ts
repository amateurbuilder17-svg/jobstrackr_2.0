import "server-only";

import { adminDb } from "@/lib/db/clients";
import { chunkForFilter, selectIn } from "@/lib/db/select-in";
import { toSlug } from "./normalize";
import { extendsOrganization } from "./organization-name";

/**
 * Resolving a conducting body to its row, and creating one only when it really
 * is new.
 *
 * The table's own `aliases` comment has always promised that "ingestion matches
 * against name, short_name and this array before creating anything new". Only
 * the slug was ever matched, and the table paid for it: 850 of 3,963 names are
 * strict extensions of another name, because the feed sends the role welded to
 * the employer — `PSPCL ALM`, `PSPCL Assistant Lineman`, `PSPCL JE` — and
 * anything unrecognised was created on sight.
 *
 * Two changes close that. Aliases are matched, so a name written differently
 * finds the body it belongs to; and before a new row is written, the name is
 * checked against the bodies already on file for exactly that welded-on-role
 * shape. A near-duplicate organisation is not a cosmetic problem: it splits a
 * body's listings across two pages, two filters and two logos.
 */

/** One organisation, in the shape both lookups return. */
interface OrgRow {
  id: string;
  slug: string;
}

/** Everything on file under any of these keys, by slug or by alias. */
async function readByKeys(keys: string[]): Promise<{ rows: OrgRow[]; error: string | null }> {
  const db = adminDb();
  if (keys.length === 0) return { rows: [], error: null };

  const bySlug = await selectIn(keys, (chunk) =>
    db.from("organizations").select("id, slug").in("slug", chunk),
  );

  if (bySlug.error) return { rows: [], error: bySlug.error.message };

  const rows: OrgRow[] = [...bySlug.data];

  // `aliases` is an array column, so this is an overlap rather than an `in` —
  // "does this row's alias list contain any key I am asking about".
  for (const chunk of chunkForFilter(keys)) {
    const { data, error } = await db
      .from("organizations")
      .select("id, slug, aliases")
      .overlaps("aliases", chunk);

    if (error) return { rows: [], error: error.message };

    for (const row of data) {
      // The alias that matched is the key the caller asked under, so the row is
      // recorded against each of them rather than against its own slug.
      for (const alias of row.aliases) {
        if (keys.includes(alias)) rows.push({ id: row.id, slug: alias });
      }
    }
  }

  return { rows, error: null };
}

/**
 * Maps organisation names in a batch to ids, creating any that are genuinely new.
 *
 * A name that does not exist yet is normal — a new recruiting body appears
 * every few weeks, and refusing to create one would amount to dead-lettering
 * every job it posts. What is not normal is `PSPCL JE`, and that is what the
 * extension check catches before it becomes another row.
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

  const { rows, error } = await readByKeys([...names.keys()]);
  if (error) throw new Error(`resolveOrganizations: ${error}`);

  const bySlug = new Map(rows.map((o) => [o.slug, o.id]));

  const unknown = [...names.keys()].filter((slug) => !bySlug.has(slug));

  if (unknown.length > 0) {
    // Every shorter reading of each unknown name. If one of them is already a
    // body, this name is that body with a role attached.
    const stems = new Set<string>();
    for (const slug of unknown) {
      const words = slug.split("-");
      for (let n = 1; n < words.length; n += 1) stems.add(words.slice(0, n).join("-"));
    }

    const existing = await readByKeys([...stems]);
    if (existing.error) throw new Error(`resolveOrganizations: ${existing.error}`);

    const stemToId = new Map(existing.rows.map((o) => [o.slug, o.id]));

    const create: string[] = [];
    for (const slug of unknown) {
      // Longest first, so `pspcl-assistant` wins over `pspcl` when both exist.
      const words = slug.split("-");
      let matched: string | undefined;
      for (let n = words.length - 1; n >= 1 && !matched; n -= 1) {
        const stem = words.slice(0, n).join("-");
        if (stemToId.has(stem) && extendsOrganization(stem, slug)) matched = stemToId.get(stem);
      }

      if (matched) bySlug.set(slug, matched);
      else create.push(slug);
    }

    if (create.length > 0) {
      const { data: created, error: createError } = await db
        .from("organizations")
        .insert(create.map((slug) => ({ slug, name: names.get(slug) ?? slug })))
        .select("id, slug");

      if (createError) throw new Error(`resolveOrganizations: ${createError.message}`);
      for (const o of created) bySlug.set(o.slug, o.id);
    }
  }

  for (const [slug, name] of names) {
    const id = bySlug.get(slug);
    if (id) out.set(name, id);
  }

  return out;
}

/**
 * Resolves lookup keys read out of a title — and never creates anything.
 *
 * The distinction is the whole safety of it. A name the feed supplied is a
 * claim about the employer; a fragment of a title is a guess, and a guess must
 * be allowed to match a body that exists but never to invent one. Reading
 * `GSSSB X-Ray Technician Class 3 Recruitment 2026` as a new organisation is
 * precisely how the 850 duplicates happened.
 */
export async function lookupOrganizationsByKeys(keys: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(keys.filter(Boolean))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;

  const { rows, error } = await readByKeys(unique);
  if (error) {
    // Never fatal. A row whose body could not be looked up still lands, as a
    // draft — which is strictly better than the exception that used to reject
    // it outright.
    console.error("[sync] lookupOrganizationsByKeys:", error);
    return out;
  }

  // A key that resolves to two different bodies resolves to neither.
  //
  // Duplicated rows make this real rather than theoretical: `Acharya N. G.
  // Ranga Agricultural University (ANGRAU)` and `Acharya N.G. Ranga
  // Agricultural University (ANGRAU)` both answer to `angrau`, so picking one
  // would be picking by row order. Filing a listing under the wrong employer is
  // worse than leaving it a draft, and unlike a draft nobody reports it.
  const ids = new Map<string, Set<string>>();
  for (const o of rows) {
    const seen = ids.get(o.slug) ?? new Set<string>();
    seen.add(o.id);
    ids.set(o.slug, seen);
  }

  for (const [key, seen] of ids) {
    const only = [...seen][0];
    if (seen.size === 1 && only !== undefined) out.set(key, only);
  }

  return out;
}
