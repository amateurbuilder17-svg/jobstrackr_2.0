import "server-only";

import { toSlug } from "./normalize";

/**
 * Recognising a conducting body from what the feed actually says.
 *
 * ## What the feed says, and what it means
 *
 * `organizations` was designed for this: its `aliases` comment promises that
 * "ingestion matches against name, short_name and this array before creating
 * anything new". Only the slug was ever matched, and the consequences are both
 * visible in the data:
 *
 *   **Rows rejected.** 55 jobs carry the literal `"Not Available"` where the
 *   organisation should be. `cellText` reads that as absent — correctly — and
 *   `toJobPayload` then refuses the row, because `jobs` will not let a
 *   published listing exist without a body. The name is right there in the
 *   title, unread.
 *
 *   **The table degrading.** 850 of 3,963 organisation names are strict
 *   extensions of another name — `PSPCL ALM`, `PSPCL Assistant Lineman` and
 *   `PSPCL JE` are one body stored three times, because the feed sends the role
 *   welded to the employer and anything unrecognised was created on sight.
 *
 * ## The lookup keys
 *
 * 1,039 existing names carry their own acronym in brackets — `National
 * Aluminium Company Limited (NALCO)`. Reading those is worth more than every
 * clever technique tried against this data put together: measured over the 55
 * rejected rows, exact prefix matching recovers 22 and the bracketed acronym a
 * further 19, for 41. Initialism matching and searching for a known name
 * anywhere in the title each added nothing the acronym had not already caught.
 *
 * So: two keys, and no fuzziness at all. Fuzzy matching an employer is how a
 * listing ends up filed under the wrong department.
 */

/** Words that carry no identity, so an initial-letter reading should skip them. */
const NOISE = new Set(["of", "and", "the", "for", "in", "at", "a"]);

/**
 * The acronym a name carries in brackets, normalised for lookup.
 *
 * `National Aluminium Company Limited (NALCO)` → `nalco`. Bounded at 12
 * characters and 2 at the minimum: a bracketed phrase longer than that is a
 * qualifier rather than an acronym — "(Recruitment Cell)" is not a name anyone
 * writes in a title.
 */
export function parentheticalAcronym(name: string): string | null {
  const match = /\(([A-Za-z][A-Za-z.&-]{1,11})\)/.exec(name);
  if (!match?.[1]) return null;

  const slug = toSlug(match[1]);
  return slug.length >= 2 ? slug : null;
}

/**
 * Names to look a blank-organisation row up by, longest first.
 *
 * Longest first is not cosmetic: `Bank of Baroda` must win over `Bank`, and the
 * caller takes the first key that resolves. Six words is where a title stops
 * being an employer and starts being a job — "Indian Institute of Science
 * Education and Research" is the long end of what a body is actually called.
 */
export function organizationKeysFromTitle(title: string): string[] {
  const words = toSlug(title).split("-").filter(Boolean);
  if (words.length === 0) return [];

  const keys: string[] = [];
  for (let n = Math.min(6, words.length); n >= 1; n -= 1) {
    keys.push(words.slice(0, n).join("-"));
  }

  return [...new Set(keys)];
}

/**
 * Is `candidate` the same body as `existing`, with something extra welded on?
 *
 * Word-boundary containment, and deliberately not a substring test: `pspcl-je`
 * extends `pspcl`, but `ssc-gd` must not be read as extending `ss`. The check
 * runs before anything is created, so a role-polluted name resolves to the body
 * already on file rather than becoming its 850th near-duplicate.
 */
export function extendsOrganization(existing: string, candidate: string): boolean {
  if (existing === candidate || existing.length === 0) return false;
  return candidate.startsWith(`${existing}-`);
}

/**
 * The initials of a name, for reading an acronym that nobody bracketed.
 *
 * Kept because it is nearly free and occasionally right — `Punjab State Power
 * Corporation Limited` → `pspcl`. It earned nothing on the 55 measured rows
 * once bracketed acronyms were read, so it is offered as a lookup key and never
 * as a reason to create anything.
 */
export function initialism(name: string): string | null {
  const words = toSlug(name)
    .split("-")
    .filter((w) => w && !NOISE.has(w));

  if (words.length < 3) return null;

  const letters = words.map((w) => w[0] ?? "").join("");
  return letters.length >= 3 ? letters : null;
}
