import "server-only";

import { adminDb, sessionDb } from "../clients";
import { PAGE_SIZE } from "../cursor";
import { unwrap } from "../errors";
import type { ExamStatusReport, StatusReport, StatusSource } from "@/lib/exams/report";
import type { Json } from "../database.types";

/**
 * Reading and writing the shared AI status cache.
 *
 * The read is per-user in the sense that only signed-in people do it, but the
 * rows are not: `exam_status_reports_read` lets any authenticated caller select
 * any report, because a report is a public fact about a public exam. That is
 * what makes the cache worth having — a hundred people tracking SSC CGL share
 * one model call, not a hundred.
 *
 * The write goes through `adminDb`, which bypasses RLS. That is safe here for
 * one specific reason and it is worth stating plainly: the route has already
 * verified, with the session client, that the caller owns an attempt whose
 * subject this is, and has already claimed quota. Nothing in this module makes
 * that check — do not call `saveStatusReport` from anywhere that has not.
 */

const REPORT_COLUMNS =
  "subject_key, subject_label, report, confidence, model, grounded, sources, refreshed_at, refresh_count" as const;

interface ReportRow {
  subject_key: string;
  subject_label: string;
  report: unknown;
  confidence: number | null;
  model: string;
  grounded: boolean;
  sources: unknown;
  refreshed_at: string;
  refresh_count: number;
}

/**
 * The stored shape, checked rather than assumed.
 *
 * The app is the only writer and it writes the canonical shape, so this should
 * never fail. It is here because "should never" is how the old project ended up
 * with four shapes in one column: a row written by an older deploy outlives the
 * code that wrote it, and a reader that trusts JSONB blindly renders `undefined
 * is not an object` on somebody's tracker rather than a missing panel.
 */
function isStatusReport(value: unknown): value is StatusReport {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StatusReport>;
  return typeof candidate.stage === "string" && Array.isArray(candidate.phases);
}

function toSources(value: unknown): StatusSource[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is StatusSource =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as StatusSource).url === "string" &&
      typeof (item as StatusSource).title === "string",
  );
}

function toReport(row: ReportRow): (ExamStatusReport & { refreshCount: number }) | null {
  if (!isStatusReport(row.report)) {
    console.warn(`[exam-status] unreadable cached report for ${row.subject_key}`);
    return null;
  }

  return {
    subjectKey: row.subject_key,
    subjectLabel: row.subject_label,
    report: row.report,
    confidence: row.confidence,
    model: row.model,
    grounded: row.grounded,
    sources: toSources(row.sources),
    refreshedAt: row.refreshed_at,
    refreshCount: row.refresh_count,
  };
}

/**
 * The reports for a tracker page's worth of attempts, keyed by subject.
 *
 * One query for the whole page rather than one per row: a tracker with twelve
 * exams on it is twelve round trips done the obvious way, on a page that is
 * already dynamic because it reads cookies.
 *
 * Duplicate keys are expected and are the point — two attempts at the same exam
 * in different years share a subject and therefore share the answer.
 */
export async function listStatusReports(
  subjectKeys: string[],
): Promise<Map<string, ExamStatusReport>> {
  const keys = [...new Set(subjectKeys)];
  if (keys.length === 0) return new Map();

  const db = await sessionDb();

  const rows: ReportRow[] = unwrap(
    "listStatusReports",
    await db
      .from("exam_status_reports")
      .select(REPORT_COLUMNS)
      .in("subject_key", keys)
      .limit(PAGE_SIZE.attempts),
  );

  const byKey = new Map<string, ExamStatusReport>();
  for (const row of rows) {
    const report = toReport(row);
    if (report) byKey.set(row.subject_key, report);
  }
  return byKey;
}

/** One report, for the refresh route's freshness check. */
export async function getStatusReport(
  subjectKey: string,
): Promise<(ExamStatusReport & { refreshCount: number }) | null> {
  const db = await sessionDb();

  const { data, error } = await db
    .from("exam_status_reports")
    .select(REPORT_COLUMNS)
    .eq("subject_key", subjectKey)
    .maybeSingle();

  if (error) {
    // A cache miss and a cache failure should behave the same way: ask the
    // model. Throwing here would turn a degraded cache into a broken feature.
    console.warn(`[exam-status] cache read failed for ${subjectKey}: ${error.message}`);
    return null;
  }

  return data ? toReport(data) : null;
}

export interface SaveReportInput {
  subjectKey: string;
  subjectLabel: string;
  examId: string | null;
  jobId: string | null;
  report: StatusReport;
  sources: StatusSource[];
  grounded: boolean;
  model: string;
  /** The count on the row being replaced, so the tally survives the upsert. */
  previousCount: number;
}

/**
 * Write a fresh report, replacing whatever was there.
 *
 * An upsert rather than an update: the common case for a newly tracked exam is
 * that no row exists yet, and doing it in one statement means two people
 * pressing Refresh at the same instant produce one row rather than one row and
 * one 23505.
 *
 * `refresh_count` is carried by the caller because PostgREST cannot express
 * `refresh_count = refresh_count + 1` in an upsert, and the caller has just
 * read the row to decide whether the refresh was needed at all — so the read
 * this would otherwise cost has already happened.
 */
export async function saveStatusReport(input: SaveReportInput): Promise<void> {
  const { error } = await adminDb()
    .from("exam_status_reports")
    .upsert(
      {
        subject_key: input.subjectKey,
        subject_label: input.subjectLabel,
        exam_id: input.examId,
        job_id: input.jobId,
        report: input.report as unknown as Json,
        confidence: input.report.confidence,
        model: input.model,
        grounded: input.grounded,
        sources: input.sources as unknown as Json,
        refresh_count: input.previousCount + 1,
        refreshed_at: new Date().toISOString(),
      },
      { onConflict: "subject_key" },
    );

  if (error) {
    // Non-fatal by design. The caller has an answer in hand and the person
    // waiting should see it; failing to cache costs the next reader a call,
    // which is a worse outcome than this one but not a failed request.
    console.error(`[exam-status] cache write failed for ${input.subjectKey}: ${error.message}`);
  }
}
