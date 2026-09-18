/**
 * Rail composition for the update detail page.
 *
 * The page carries four strips of links — the same-organisation siblings, the
 * newest results, the newest admit cards, and open jobs matching the same term.
 * Three of those are drawn from queries that know nothing about each other or
 * about the page they land on, which produces two problems this module exists
 * to solve.
 *
 * **A page must not link to itself.** The rails are deliberately keyed on a
 * category rather than on a slug so that every update page shares one cache
 * entry — see `listLatestInCategory`. The cost of that decision is that the
 * current update is in its own category's rail, and the exclusion has to happen
 * here, after the cache, where it is free.
 *
 * **A page should not link to the same update twice.** An SSC result page's
 * sibling rail and the newest-results rail overlap heavily, and a reader who
 * sees the same headline in two strips reads it as a bug. Repeating a link also
 * spends the page's internal-link budget saying one thing twice.
 *
 * Both are set arithmetic, which is why they are here as pure functions with
 * tests rather than inline in a Server Component where neither can be checked.
 */

/** The shape every rail row shares. Rails hold cards; this is all they need. */
export interface RailRow {
  id: string;
  slug: string;
}

/**
 * Picks the rows for one rail, skipping anything already on the page.
 *
 * `taken` is read *and* written: pass the same set down a list of rails and
 * each one claims its rows, so a later rail never repeats an earlier one. The
 * order the rails are composed in is therefore the order of precedence, which
 * is the intended behaviour — the sibling rail is the most specific to this
 * page, so it composes first and keeps its rows.
 */
export function pickRailRows<T extends RailRow>(
  rows: readonly T[],
  taken: Set<string>,
  limit: number,
): T[] {
  if (limit <= 0) return [];

  const picked: T[] = [];
  for (const row of rows) {
    if (picked.length >= limit) break;
    if (taken.has(row.slug)) continue;
    taken.add(row.slug);
    picked.push(row);
  }
  return picked;
}

/**
 * The set of slugs a page has already committed to linking.
 *
 * Seeded with the page's own slug, which is the exclusion that matters most:
 * without it, every result page's "Latest results" rail opens with a link back
 * to the page the reader is standing on.
 */
export function takenSlugs(ownSlug: string, ...rails: readonly RailRow[][]): Set<string> {
  const taken = new Set<string>([ownSlug]);
  for (const rail of rails) {
    for (const row of rail) taken.add(row.slug);
  }
  return taken;
}
