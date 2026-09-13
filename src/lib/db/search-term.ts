import { SEARCH_CONFIG } from "./tags";

/**
 * What someone typed into a search box, as PostgREST filters.
 *
 * ── Why not `websearch_to_tsquery` ─────────────────────────────────────────
 * Every list search used to hand the raw term to `type: "websearch"`, which
 * matches whole stemmed words only. "ssc steno" became `'ssc' & 'steno'`, and
 * "Stenographer" is indexed as `'stenograph'` — so the search returned nothing
 * on /updates and nothing on /jobs, measured against production on 11 Sep 2026,
 * while 13 updates and the open SSC Stenographer notice were sitting right
 * there. Readers type abbreviations and half-words ("steno", "je civil",
 * "asst"), and the old app answered them because it matched substrings.
 *
 * So every token is a prefix now: "ssc steno" is `ssc:* & steno:*`, which
 * finds all 13, still on the GIN index.
 *
 * ── Why longer tokens also try the title as a substring ────────────────────
 * A prefix is stemmed before it is matched, and a half-typed word does not
 * always stem to a prefix of the whole one: "recruitme" is not a prefix of the
 * lexeme `'recruit'`, so a reader who pauses mid-word sees the list empty out.
 * For tokens of `SUBSTRING_MIN` characters or more the title is also searched
 * with `ilike`, which covers that, and gives back the old app's "spector" finds
 * "inspector". Short tokens do not get it: `%ssc%` pulls in every BSSC and
 * UKSSSC notice, which is not what someone typing "ssc" asked for.
 *
 * The `ilike` branch cannot use the GIN index. That is a scan over at most a
 * few thousand published titles, which Postgres does in milliseconds.
 */
export interface SearchFilter {
  /** Short tokens, each a prefix, AND-ed — for `.textSearch("search_vector", …)`. */
  tsquery: string | null;
  /** One `.or(…)` filter per longer token. Repeated `or` params are AND-ed. */
  orFilters: string[];
}

/** Tokens this long or longer also match anywhere in the title. */
const SUBSTRING_MIN = 6;

/** Enough for any real query, and a bound on the filter a URL can build. */
const MAX_TOKENS = 6;

/**
 * Words that describe the whole site rather than narrowing it. Every row is an
 * exam, a job or an update, and plenty of titles never say so — "SSC CGL Admit
 * Card" has no "exam" in it — so requiring the word loses rows for nothing.
 * Dropped only when something else is left to search on.
 */
const FILLER = new Set(["exam", "exams", "job", "jobs", "update", "updates", "latest"]);

export function toSearchFilter(raw: string | undefined): SearchFilter | null {
  // Reduced to `[a-z0-9 ]` before anything else, which is what makes it safe
  // to splice into both grammars below: no tsquery operator (`& | ! : ( )`)
  // and no PostgREST delimiter (`, . ( )`) can survive this line.
  const folded = (raw ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  // A single character is treated as no filter rather than as a search that
  // matches nothing: it is almost always a keystroke on the way to a real
  // term, and emptying the page mid-typing reads as breakage.
  if (folded.length < 2) return null;

  const unique = [...new Set(folded.split(" "))];
  const meaningful = unique.filter((token) => !FILLER.has(token));
  const tokens = (meaningful.length > 0 ? meaningful : unique).slice(0, MAX_TOKENS);

  const short: string[] = [];
  const orFilters: string[] = [];

  for (const token of tokens) {
    if (token.length >= SUBSTRING_MIN) {
      orFilters.push(
        `search_vector.fts(${SEARCH_CONFIG}).${token}:*,title.ilike.*${token}*`,
      );
    } else {
      // One character stays exact: `d:*` in "group d" would match every word
      // beginning with d.
      short.push(token.length === 1 ? token : `${token}:*`);
    }
  }

  return { tsquery: short.length > 0 ? short.join(" & ") : null, orFilters };
}
