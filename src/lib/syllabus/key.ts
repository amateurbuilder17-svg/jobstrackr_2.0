/**
 * Turning what somebody typed into the one thing the cache is keyed on.
 *
 * This is the whole economics of the feature. A grounded model call takes
 * 25–35 seconds and spends a key from a pool with a daily cap; a cache hit
 * costs one indexed select. Whether "SSC CGL 2025", "ssc cgl", "SSC  CGL 2024"
 * and "Ssc Cgl Exam" are one entry or four decides which of those two things
 * happens for almost every visitor.
 *
 * Pure and dependency-free, so it can be tested against real search strings
 * without a database or a model.
 */

/**
 * Words that carry no information about *which* exam this is.
 *
 * Dropped before the key is built, so "SSC CGL exam syllabus" and "SSC CGL"
 * are the same lookup. Deliberately short: every word here is one a person
 * might otherwise have used to distinguish two exams, and the cost of removing
 * a meaningful word is two exams sharing one cached syllabus.
 */
const NOISE = new Set(["exam", "exams", "examination", "syllabus", "pattern", "for", "the"]);

/**
 * The cache key: an exam without its year.
 *
 * The year comes out on purpose. A syllabus changes when the conducting body
 * revises it, not on 1 January, and someone searching "SSC CGL 2026" in
 * December 2025 wants the syllabus that exists, not a miss. The entry records
 * the year the model reported; the key does not carry it.
 */
export function syllabusKey(input: string): string {
  return words(input).join(" ");
}

/** The URL segment for a key. Same input, same page, shareable. */
export function syllabusSlug(input: string): string {
  return words(input).join("-");
}

function words(input: string): string[] {
  return (
    input
      .toLowerCase()
      // Any run of four digits starting 19 or 20 is a year. Bare `\d{4}` would
      // eat the "2024" out of a post code or a paper number; this is narrow
      // enough to leave those alone.
      .replace(/\b(?:19|20)\d{2}\b/g, " ")
      // Anything that is not a letter or a digit becomes a gap. That folds
      // "SSC-CGL", "SSC/CGL" and "SSC (CGL)" onto the same key, and it is why
      // this runs before the split rather than after.
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((word) => word.length > 0 && !NOISE.has(word))
  );
}

/**
 * Whether a search is worth spending a model call on.
 *
 * Two characters is not an exam name, and the grounded call it would trigger
 * costs the same as a real one. The ceiling is generous — some conducting
 * bodies have genuinely long names — and exists only to stop a paste of an
 * entire notification becoming a cache key.
 */
export function isSearchable(input: string): boolean {
  const key = syllabusKey(input);
  return key.length >= 3 && key.length <= 120;
}
