/**
 * What an attempt is *about*, as a cache key.
 *
 * `exam_attempts_has_subject` allows three kinds of row: one naming an exam,
 * one naming a job, and one carrying free text. The AI status cache is shared
 * across users — one person refreshing SSC CGL answers it for everyone tracking
 * SSC CGL — so it needs a key that means "the same exam", not "the same row".
 *
 * The precedence matters. A row created by pressing Track on a job page carries
 * a `job_id` and no `exam_id`; a row added by hand from the tracker carries an
 * `exam_id`. Where a row somehow has both, the exam wins: it is the more stable
 * subject, and it is the one other people's rows are keyed on.
 *
 * Zero imports — this is called from the route, from the cron, and from the
 * page, and it is the one thing all three must agree on exactly.
 */

export interface AttemptSubjectRow {
  exam_id: string | null;
  job_id: string | null;
  custom_name: string | null;
}

/** Longer than any real exam name; matches the CHECK constraint on the column. */
const MAX_NAME_KEY = 120;

/**
 * Free text, reduced to something two people typing the same exam will agree
 * on. "SSC CGL 2026", "ssc-cgl 2026" and "SSC  CGL, 2026" all key the same.
 *
 * It is a blunt instrument and known to be one: "CGL" and "SSC CGL" remain
 * different subjects. That is the right failure — a key that collapsed them
 * would serve one person's answer to another person's exam, and being
 * accurate-or-absent beats being confidently wrong.
 */
export function normalizeSubjectName(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      // Strip accents, then anything that is not a letter or digit.
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, MAX_NAME_KEY)
      // A trailing hyphen can reappear after the slice.
      .replace(/-+$/g, "")
  );
}

/**
 * The cache key, or null for a row with no usable subject.
 *
 * Null should be unreachable — the database constraint refuses such a row —
 * but a caller that trusted it blindly would produce the key `"name:"`, which
 * the table's CHECK constraint rejects at 3am rather than here.
 */
export function subjectKeyFor(row: AttemptSubjectRow): string | null {
  if (row.exam_id) return `exam:${row.exam_id}`;
  if (row.job_id) return `job:${row.job_id}`;

  const slug = normalizeSubjectName(row.custom_name ?? "");
  return slug === "" ? null : `name:${slug}`;
}

/** The `exam_id` / `job_id` columns to store alongside a key, for the cascade. */
export function subjectColumnsFor(row: AttemptSubjectRow): {
  exam_id: string | null;
  job_id: string | null;
} {
  if (row.exam_id) return { exam_id: row.exam_id, job_id: null };
  if (row.job_id) return { exam_id: null, job_id: row.job_id };
  return { exam_id: null, job_id: null };
}
