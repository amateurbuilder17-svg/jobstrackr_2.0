import type { SyllabusDirectoryEntry } from "@/lib/db/queries/syllabus";
import { syllabusKey } from "@/lib/syllabus/key";

import { POPULAR_EXAMS } from "./popular";

/**
 * The typeahead's suggestion pool, built on the server.
 *
 * It could as easily be built in the search box from the rows it receives, and
 * it was, for about an hour. Moving it here is worth its own module for one
 * measured reason: `/syllabus` has a first-load JavaScript budget of 161 kB and
 * was at 159.2 kB before this feature. Building the pool in the browser meant
 * shipping `syllabusKey`, the popular-exams table and the de-duplication loops,
 * and put the route at 160.7 kB — under the ceiling, but with 0.3 kB of room,
 * which is the state budget.json's own notes warn about.
 *
 * Precomputing costs nothing at runtime — it happens inside the same cached
 * render as the queries that feed it, once per cache window — and leaves the
 * browser with a list and a substring test.
 */

/**
 * How much of the syllabus directory to hand the browser.
 *
 * That query is capped at 500 rows for the sitemap, and serialising all of them
 * to filter six would pay in bytes what the client-side filtering saves in
 * reads. The most recent 60 covers the typeahead's real job — finding an exam
 * this app has already fetched — and anything past it is still reachable by
 * searching, which hits the same cache on the server.
 */
const CACHED_POOL = 60;

/**
 * How many distinct vacancies to hand the browser.
 *
 * This one was chosen from a measurement rather than a feeling. Gzipped, on
 * top of the 16.0 kB `/syllabus` document: 100 entries costs 1.5 kB, 200 costs
 * 2.2 kB, 300 costs 3.5 kB, and the full 5,200-row production corpus would cost
 * 79 kB. 250 sits on the flat part of that curve, and because job titles repeat
 * across years and regions — 75% dedupe on the seeded corpus — it represents
 * far more than 250 rows of the table.
 */
const JOB_POOL = 250;

/** What a row in the dropdown is, which decides where clicking it goes. */
export type SuggestionKind =
  /** Already fetched. A link to a static page, and free. */
  | "cached"
  /** Not fetched yet. Submits the search, which may spend a model call. */
  | "exam"
  /** An open vacancy. A link to the job, and free. */
  | "job";

export interface Suggestion {
  /** The normalised name, and what the query is matched against. */
  key: string;
  name: string;
  kind: SuggestionKind;
  /** Where clicking goes; null means "put this in the box and search". */
  href: string | null;
  note: string;
}

export function buildSuggestions(
  directory: SyllabusDirectoryEntry[],
  jobs: { title: string; slug: string }[],
): Suggestion[] {
  const rows: Suggestion[] = [];
  const seen = new Set<string>();

  // Cached first, so "SSC CGL" resolves to the row that opens instantly rather
  // than to the popular tile that would spend a search rediscovering it.
  for (const entry of directory.slice(0, CACHED_POOL)) {
    const key = syllabusKey(entry.examName);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      key,
      name: entry.examName,
      kind: "cached",
      href: `/syllabus/${entry.slug}`,
      note: entry.year === null ? "Saved" : `${String(entry.year)} · Saved`,
    });
  }

  for (const exam of POPULAR_EXAMS) {
    const key = syllabusKey(exam.name);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ key, name: exam.name, kind: "exam", href: null, note: exam.description });
  }

  /*
   * Vacancies last, and only for exams nothing above already covers.
   *
   * The exclusion is the important half. A job titled "SSC CGL 2025" keys to
   * the same "ssc cgl" as the cached syllabus, and offering both would put two
   * rows with the same words in the list going to different places. The row
   * that survives is the one already above it, which is either a syllabus that
   * exists or a popular exam worth searching for.
   *
   * `seen` also collapses the years and regions: "SSC CGL 2024" and "SSC CGL
   * 2025" are one key, so the first one — the most recently updated, since the
   * query orders that way — is the one that gets suggested.
   */
  let added = 0;
  for (const job of jobs) {
    if (added >= JOB_POOL) break;
    const key = syllabusKey(job.title);
    // A title that normalises to almost nothing is not searchable and is not a
    // useful suggestion either.
    if (key.length < 3 || seen.has(key)) continue;
    seen.add(key);
    added += 1;
    rows.push({
      key,
      name: job.title,
      kind: "job",
      href: `/jobs/${job.slug}`,
      note: "Vacancy",
    });
  }

  return rows;
}
