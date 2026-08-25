import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { publicDb, sessionDb } from "../clients";
import { PAGE_SIZE } from "../cursor";
import { unwrap } from "../errors";
import { tags } from "../tags";
import type { Database } from "../database.types";

/**
 * Tracker reads.
 *
 * `listExamAttempts` is per-user and therefore uncached, for the same reason as
 * the saved list. `listExams` is public reference data — the same dozen rows for
 * everyone — so it caches like any other content read.
 */

type AttemptRow = Database["public"]["Tables"]["exam_attempts"]["Row"];

export type ExamAttempt = Pick<
  AttemptRow,
  | "id"
  | "exam_id"
  | "custom_name"
  | "stage"
  | "status"
  | "applied_at"
  | "exam_date"
  | "result_date"
  | "roll_number"
  | "score"
  | "notes"
  | "job_id"
> & {
  /** Null for an exam this app has never heard of, which is a supported case. */
  exam: { slug: string; name: string; short_name: string | null } | null;
  /** Set when the attempt was started by pressing Track on a job page. */
  job: { slug: string; title: string } | null;
};

const ATTEMPT_COLUMNS =
  "id, exam_id, job_id, custom_name, stage, status, applied_at, exam_date, result_date, roll_number, score, notes, exam:exams ( slug, name, short_name ), job:jobs ( slug, title )" as const;

export async function listExamAttempts(): Promise<ExamAttempt[]> {
  const db = await sessionDb();

  const rows: ExamAttempt[] = unwrap(
    "listExamAttempts",
    await db
      .from("exam_attempts")
      .select(ATTEMPT_COLUMNS)
      // Soonest exam first, undated last — someone opening this page wants to
      // know what is coming, not what they added most recently.
      .order("exam_date", { ascending: true, nullsFirst: false })
      .limit(PAGE_SIZE.attempts),
  );

  return rows;
}

export interface ExamOption {
  id: string;
  name: string;
  short_name: string | null;
}

/** The exam picker's options. Public reference data, so it caches. */
export async function listExams(): Promise<ExamOption[]> {
  "use cache";
  cacheLife("content");
  cacheTag(tags.examList());

  return unwrap(
    "listExams",
    await publicDb()
      .from("exams")
      .select("id, name, short_name")
      .eq("is_active", true)
      .order("name", { ascending: true })
      .limit(PAGE_SIZE.admin),
  );
}

/**
 * Which jobs the current user tracks, as ids.
 *
 * The sibling of `listSavedJobIds`, and it rides on the same request: the
 * job page and every job card need one bit per job, and a second round trip
 * to learn a second bit would double the per-session cost of keeping the
 * static pages static. See `/api/saved`.
 */
export async function listTrackedJobIds(): Promise<string[]> {
  const db = await sessionDb();

  const rows = unwrap(
    "listTrackedJobIds",
    await db
      .from("exam_attempts")
      .select("job_id")
      .not("job_id", "is", null)
      .limit(PAGE_SIZE.savedIds),
  );

  // `job_id` is non-null by the filter above, and the generated type agrees.
  return rows.map((row) => row.job_id);
}
