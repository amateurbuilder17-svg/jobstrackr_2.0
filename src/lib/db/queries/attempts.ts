import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { publicDb, sessionDb } from "../clients";
import { PAGE_SIZE } from "../cursor";
import { DbError, unwrap } from "../errors";
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

/**
 * One attempt, with everything the status prompt needs to name its subject.
 *
 * A separate query from `listExamAttempts` rather than widening it: the
 * conducting body and the official website are two extra joins that the list
 * never renders, and this is fetched once per refresh rather than once per row.
 */
export interface AttemptSubject {
  id: string;
  exam_id: string | null;
  job_id: string | null;
  custom_name: string | null;
  stage: string | null;
  status: string;
  exam_date: string | null;
  result_date: string | null;
  exam: {
    name: string;
    official_website: string | null;
    organization: { name: string } | null;
  } | null;
  job: {
    title: string;
    source_url: string | null;
    organization: { name: string } | null;
  } | null;
}

const SUBJECT_COLUMNS =
  "id, exam_id, job_id, custom_name, stage, status, exam_date, result_date, " +
  "exam:exams ( name, official_website, organization:organizations ( name ) ), " +
  "job:jobs ( title, source_url, organization:organizations ( name ) )";

/**
 * Returns null for an id that is not this user's, rather than throwing.
 *
 * RLS is what enforces that — the filter below is belt to its braces — and a
 * forged id therefore reads as "no such attempt", which is both true from the
 * caller's perspective and the answer that leaks least.
 */
export async function getAttemptSubject(id: string): Promise<AttemptSubject | null> {
  const db = await sessionDb();

  const { data, error } = await db
    .from("exam_attempts")
    .select(SUBJECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new DbError("getAttemptSubject", error);
  return data as AttemptSubject | null;
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
