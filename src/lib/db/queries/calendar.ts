import "server-only";

import { sessionDb } from "../clients";
import { PAGE_SIZE } from "../cursor";
import { unwrap } from "../errors";
import { listExamAttempts } from "./attempts";
import { listStatusReports } from "./exam-status";
import type { EventType } from "@/lib/exams/report";
import { subjectKeyFor } from "@/lib/exams/subject";

/**
 * Calendar reads.
 *
 * One function, and it reads one person's dates.
 *
 * What used to live here was `listDeadlinesInMonth` — every published job
 * closing inside a given month, up to 300 rows, one query per month navigated.
 * It is gone rather than kept beside this: the page it served showed a reader
 * three hundred deadlines belonging to other people, and leaving the query in
 * place would leave the next person to touch this file a choice between two
 * calendars. There is one calendar, and it is curated.
 */

/* ── The personal calendar ──────────────────────────────────────────────── */

/**
 * What the calendar page actually renders.
 *
 * The question this answers is *my dates*, and the emphasis is the point. The
 * query it replaces answered "what closes in March" — for a published table of
 * 2,593 jobs, a wall of other people's deadlines, thirty red dots on a grid
 * none of which the reader has any relationship to. A calendar whose every
 * square is marked marks nothing. One row per date that
 * belongs to something the reader saved or is tracking, and nothing else.
 *
 * ## Where a date can come from
 *
 * Three sources, in descending order of how much we trust them:
 *
 *   1. **The notification** — `jobs.application_start_date` and
 *      `jobs.last_date`. Ingested from the official posting; these are facts.
 *   2. **The person** — `exam_attempts.exam_date` and `result_date`, which the
 *      user either typed or accepted from a report.
 *   3. **The AI status report** — `exam_status_reports.report.events`. The only
 *      source for an admit-card date, because no column holds one, and the only
 *      source at all for a phase-two Mains date.
 *
 * Where two sources describe the same thing the earlier one wins, and anything
 * that reached the grid from (3) alone is flagged `predicted` so the UI can say
 * so. A calendar that shows a guessed date the same way it shows a gazetted one
 * is worse than a calendar with a gap in it.
 *
 * ## Cost
 *
 * Three reads, the same shape and roughly the same size as the tracker page's,
 * and they cover *every* month rather than one. The old page cost one read per
 * month navigated, unbounded at 300 rows a time; this costs three for the whole
 * timeline, and paging between months touches the network not at all.
 *
 * Per-user, so nothing here caches — see the note at the top of `saved.ts`.
 */

/**
 * The five things that happen to an exam.
 *
 * `EventType` from the report module, re-exported rather than redeclared. The
 * five strings already exist there because the model is asked for exactly these
 * — a second list here would be a second thing to keep in step, and the first
 * time it drifted the calendar would silently drop a category the model still
 * emits.
 */
export type CalendarEventType = EventType;

export interface PersonalEvent {
  /** Unique per row; the grid and the lists both key on it. */
  id: string;
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  type: CalendarEventType;
  /** Groups every event belonging to one exam onto one card. */
  subjectKey: string;
  /** The exam as the reader named it — a job title, or their own text. */
  subject: string;
  organization: string | null;
  /** Where the detail lives, or null for a free-text attempt with no page. */
  href: string | null;
  /** Tracked outranks saved: it is the stronger statement of intent. */
  source: "tracked" | "saved";
  /** "Prelims" / "Mains", where the report attributed the date to a phase. */
  phase: string | null;
  /** True when only the AI report knew this date. */
  predicted: boolean;
}

/**
 * One subject's worth of raw material, before it becomes events.
 *
 * Assembled from the attempt and saved rows first so that a job which is both
 * saved *and* tracked collapses into one card rather than two — keyed on the
 * subject, which is what `subjectKeyFor` already means everywhere else.
 */
interface Subject {
  key: string;
  label: string;
  organization: string | null;
  href: string | null;
  source: "tracked" | "saved";
  applicationStart: string | null;
  lastDate: string | null;
  examDate: string | null;
  resultDate: string | null;
}

/**
 * The saved shortlist, reduced to the four fields a calendar needs.
 *
 * A deliberately separate query rather than `listSavedJobs()`, which selects
 * eighteen columns to draw a card. Nothing here draws a card: five columns is
 * about a fifth of the egress for exactly the same answer.
 */
async function listSavedJobDates(): Promise<
  {
    job_id: string;
    job: {
      slug: string;
      title: string;
      application_start_date: string | null;
      last_date: string | null;
      organization: { short_name: string | null; name: string } | null;
    } | null;
  }[]
> {
  const db = await sessionDb();

  return unwrap(
    "listSavedJobDates",
    await db
      .from("saved_jobs")
      .select(
        `job_id, job:jobs (
           slug, title, application_start_date, last_date,
           organization:organizations ( short_name, name )
         )`,
      )
      .order("saved_at", { ascending: false })
      .limit(PAGE_SIZE.list),
  );
}

/** Every dated thing belonging to this reader, earliest first. */
export async function listPersonalEvents(): Promise<PersonalEvent[]> {
  // Neither read depends on the other, and both are needed before the subject
  // keys exist, so they go together.
  const [attempts, saved] = await Promise.all([listExamAttempts(), listSavedJobDates()]);

  const subjects = new Map<string, Subject>();

  // Tracked first, so that a job which is also saved keeps the richer row: an
  // attempt carries an exam date and a result date, a bookmark carries neither.
  for (const attempt of attempts) {
    const key = subjectKeyFor(attempt);
    if (key === null) continue;

    const label =
      attempt.job?.title ??
      attempt.exam?.short_name ??
      attempt.exam?.name ??
      attempt.custom_name;
    if (!label) continue;

    // The job's body first, because a tracked row usually started as Track on a
    // job page and that is the organisation the reader saw when they did it.
    const org = attempt.job?.organization ?? attempt.exam?.organization ?? null;

    subjects.set(key, {
      key,
      label,
      organization: org ? (org.short_name ?? org.name) : null,
      href: attempt.job ? `/jobs/${attempt.job.slug}` : null,
      source: "tracked",
      applicationStart: attempt.job?.application_start_date ?? null,
      lastDate: attempt.job?.last_date ?? null,
      examDate: attempt.exam_date,
      resultDate: attempt.result_date,
    });
  }

  for (const row of saved) {
    const job = row.job;
    // Null where the job has been unpublished since it was saved; RLS hides it
    // rather than deleting the bookmark. Same handling as the /saved page.
    if (!job) continue;

    const key = `job:${row.job_id}`;
    if (subjects.has(key)) continue;

    subjects.set(key, {
      key,
      label: job.title,
      organization: job.organization?.short_name ?? job.organization?.name ?? null,
      href: `/jobs/${job.slug}`,
      source: "saved",
      applicationStart: job.application_start_date,
      lastDate: job.last_date,
      examDate: null,
      resultDate: null,
    });
  }

  if (subjects.size === 0) return [];

  // One query for every subject on the page, tracked and saved alike. Saved
  // jobs are included because a report is a public fact about a public exam —
  // `exam_status_reports_read` lets any signed-in caller read any row — so a
  // bookmark inherits the admit-card date somebody else's refresh paid for, at
  // no extra query.
  const reports = await listStatusReports([...subjects.keys()]);

  const events: PersonalEvent[] = [];
  // Two sources naming the same event on the same day is the normal case, not
  // an anomaly: the attempt's `exam_date` was copied off the report that also
  // still carries it as an event. One dot, not two.
  const seen = new Set<string>();

  const push = (
    subject: Subject,
    type: CalendarEventType,
    date: string | null,
    predicted: boolean,
    phase: string | null,
  ) => {
    if (!date) return;
    const day = date.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return;

    const id = `${subject.key}|${type}|${day}`;
    if (seen.has(id)) return;
    seen.add(id);

    events.push({
      id,
      date: day,
      type,
      subjectKey: subject.key,
      subject: subject.label,
      organization: subject.organization,
      href: subject.href,
      source: subject.source,
      phase,
      predicted,
    });
  };

  for (const subject of subjects.values()) {
    // Known dates before predicted ones: `push` is first-write-wins, so the
    // ordering here *is* the precedence rule.
    push(subject, "application_open", subject.applicationStart, false, null);
    push(subject, "application_close", subject.lastDate, false, null);
    push(subject, "exam_date", subject.examDate, false, null);
    push(subject, "result", subject.resultDate, false, null);

    const stored = reports.get(subject.key);
    if (!stored) continue;

    for (const event of stored.report.events) {
      // The model attributes an event to phase 1 or 2; the phase's own name is
      // what a candidate calls it — "Tier 1", "Prelims" — so that is what the
      // chip says. A single-phase exam gets no label at all rather than the
      // meaningless "Phase 1".
      const phaseName =
        event.phase !== null && stored.report.phases.length > 1
          ? (stored.report.phases[event.phase - 1]?.name ?? null)
          : null;
      push(subject, event.type, event.date, true, phaseName);
    }
  }

  return events.sort(
    (a, b) => a.date.localeCompare(b.date) || a.subject.localeCompare(b.subject),
  );
}
