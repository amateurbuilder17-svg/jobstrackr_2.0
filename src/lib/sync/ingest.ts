import "server-only";

import { createHash } from "node:crypto";

import { adminDb } from "@/lib/db/clients";
import { salaryFromText } from "@/lib/format/salary";
import { sectorTagsOf } from "@/lib/jobs/sectors";
import type { Database } from "@/lib/db/database.types";
import { CHANGE_SELECT, diffWatched, type ComparableRow, type JobChange } from "./changes";
import {
  feeFromTable,
  hasDetailContent,
  toJobDetailPayload,
  vacanciesFromTable,
  type JobDetailPayload,
} from "./details";
import { resolveOrganizations } from "./organizations";
import { uniqueSlugs } from "./slugs";
import { toDate, toInt, toSalary, toSlug, toText, toVacancies, toVector } from "./normalize";

/**
 * The diff.
 *
 * The whole design is one idea: work out what actually changed before writing
 * anything. An upsert keyed on `dedupe_key` is correct but not sufficient —
 * Postgres still writes the row, bumps `updated_at`, fires the trigger and
 * dirties the cached page even when every value is identical. On a daily cron
 * over 5,231 rows that is 5,231 pointless writes and 5,231 cache invalidations
 * a day, which is how a "read-only" pipeline generates egress.
 *
 * So: hash what we would write, compare against `content_hash`, and skip the
 * ones that match. A re-run over unchanged data touches nothing.
 */

export type { JobChange, WatchedField } from "./changes";

/** A row as it arrives from the Apps Script feed: entirely untrusted. */
export type FeedRow = Record<string, unknown>;

export interface IngestResult {
  seen: number;
  inserted: number;
  updated: number;
  unchanged: number;
  failed: number;
  /** Rows that could not be normalised, for the dead-letter table. */
  failures: { sourceKey: string | null; error: string; payload: FeedRow }[];
  /** Watched fields that changed on existing rows. See `WATCHED`. */
  changes: JobChange[];
  /** Rows whose cold half — prose, dates, fee table — was written. */
  detailsWritten: number;
}

/**
 * Drops `subject` when it lands on the wrong side of `keep`, instead of
 * letting the pair fail its ordering CHECK constraint.
 *
 * `jobs_dates_ordered`, `jobs_age_range` and `jobs_salary_range` all require
 * one end of a pair to be `<=` the other. A scraped pair that violates one is
 * normal — a source page with the columns transposed, say — but a violation
 * reaching the database fails the whole bulk `insert()`, not just this row:
 * Postgres evaluates a multi-row insert as one statement, so one bad pair
 * (`application_start_date > last_date`) took the entire batch down on
 * 2026-08-26 and stopped ingestion for four days, because nothing here caught
 * it before it reached Postgres.
 */
function dropIfWrongSideOf<T extends number | string>(
  subject: T | null,
  keep: T | null,
  subjectMustBeAtMost: boolean,
): T | null {
  if (subject === null || keep === null) return subject;
  const outOfOrder = subjectMustBeAtMost ? subject > keep : subject < keep;
  return outOfOrder ? null : subject;
}

/** A payload about to be written, reduced to the comparison shape. */
function toComparable(payload: JobPayload): ComparableRow {
  return {
    last_date: payload.last_date ?? null,
    application_start_date: payload.application_start_date ?? null,
    vacancies: payload.vacancies ?? null,
    vacancies_display: payload.vacancies_display ?? null,
    application_fee: payload.application_fee ?? null,
    status: payload.status ?? "draft",
  };
}

/**
 * A stable digest of the fields ingestion writes.
 *
 * Keys are sorted, so a feed that reorders its columns does not read as a
 * change. `undefined` and `null` are normalised to the same thing for the same
 * reason — a cell going from absent to empty is not news.
 */
export function hashContent(payload: Record<string, unknown>): string {
  const canonical = JSON.stringify(
    Object.keys(payload)
      .sort()
      .map((key) => [key, payload[key] ?? null]),
  );
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * The columns ingestion writes, typed against the table rather than as a loose
 * record. A `Record<string, unknown>` would compile and then fail at runtime
 * the first time a column was renamed — this way the schema and the worker
 * cannot drift without the build saying so.
 */
type JobInsert = Database["public"]["Tables"]["jobs"]["Insert"];
export type JobPayload = Omit<JobInsert, "dedupe_key" | "content_hash" | "slug">;

/** What a job row becomes. Normalised once, here, and nowhere else. */
export function toJobPayload(
  row: FeedRow,
  organizationId: (name: string) => string | undefined,
): {
  dedupeKey: string;
  payload: JobPayload;
  organisation: string;
} {
  const title = toText(row.title);
  if (!title) throw new Error("title is required");

  const sourceUrl = toText(row.source_url);
  if (!sourceUrl) throw new Error("source_url is required");

  const organisation = toText(row.organization) ?? toText(row.department);
  if (!organisation) throw new Error("organization is required");

  // Identity, not content: the same listing keeps this key when its salary is
  // corrected, which is what lets an edit update rather than duplicate.
  const dedupeKey = createHash("sha256")
    .update(`${sourceUrl}\n${title}`)
    .digest("hex")
    .slice(0, 32);

  const lastDate = toDate(row.last_date);
  // The less essential end of each pair is dropped, not the row: `last_date`
  // (not `application_start_date`) drives status/expiry/sort, and `_min` (not
  // `_max`) is the more commonly cited figure for salary and age.
  const applicationStartDate = dropIfWrongSideOf(
    toDate(row.application_start_date),
    lastDate,
    true,
  );
  const salaryMin = toSalary(row.salary_min);
  const salaryMax = dropIfWrongSideOf(toSalary(row.salary_max), salaryMin, false);
  const ageMin = toInt(row.age_min);
  const ageMax = dropIfWrongSideOf(toInt(row.age_max), ageMin, false);
  const orgId = organizationId(organisation);

  return {
    dedupeKey,
    organisation,
    payload: {
      organization_id: orgId ?? null,
      // Publication is earned, not assumed. `jobs_published_has_essentials`
      // requires an organisation and a closing date, and it is right to: a
      // half-scraped listing reaching the public site is worse than one sitting
      // in the admin table as a draft until the next run fills it in.
      status: orgId && lastDate ? "published" : "draft",
      title,
      source_url: sourceUrl,
      location: toText(row.location),
      state: toText(row.state),
      vacancies: toVacancies(row.vacancies),
      vacancies_display: toText(row.vacancies_display),
      // `qualification` is what the Jobs tab of the sheet calls this column,
      // and what the old project's table called it. Reading only the new name
      // left it NULL on every row the live feed sends — and 0011 and 0019
      // generate `required_stream` and `min_qualification_level` from it, so
      // every job synced from the sheet would have been silently excluded from
      // matching. Generated columns cannot be forgotten; the text they read
      // from can.
      qualification_summary: toText(row.qualification_summary) ?? toText(row.qualification),
      salary_min: salaryMin,
      salary_max: salaryMax,
      salary_display: toText(row.salary_display),
      application_fee: toInt(row.application_fee),
      age_min: ageMin,
      age_max: ageMax,
      experience_years_min: toInt(row.experience_years_min),
      application_start_date: applicationStartDate,
      last_date: lastDate,
      // Kept as typed, because "TBD" is a real answer this column must carry
      // without the date column inventing one.
      last_date_display: toText(row.last_date_display),
      // Derived here, not carried from the feed.
      //
      // The feed does not send tags for jobs — 6,692 of 6,821 rows had none —
      // and the 129 that did were backfilled from the old project's
      // `generateTags`, whose unanchored `includes()` matching filed a PSC
      // exam under railways and tagged 59 unrelated rows `insurance` because
      // "public" contains "lic". `sectorTagsOf` reads the title and the
      // employer and emits `SECTORS` values, which is the only vocabulary the
      // sector chips and `preferred_sectors` can match against.
      tags: sectorTagsOf({ title, organization: organisation }),
      embedding: toVector(row.embedding) as string | null,
    },
  };
}

/**
 * The pay figures to store, given what the feed typed and what it wrote in
 * prose.
 *
 * Exported for the test, and split out because the fallback is not "fill the
 * empty column": both ends move together or neither does. Taking the min from
 * the sentence while leaving a typed max in place would build a range out of
 * two different readings of the same notification.
 */
export function salaryWithFallback(
  payload: JobPayload,
  salaryText: string | null,
): Pick<JobPayload, "salary_min" | "salary_max"> {
  const typedMin = payload.salary_min ?? null;
  const typedMax = payload.salary_max ?? null;
  if (typedMin !== null || typedMax !== null) {
    return { salary_min: typedMin, salary_max: typedMax };
  }
  const { min, max } = salaryFromText(salaryText);
  return { salary_min: min, salary_max: max };
}

/**
 * Ingest a batch of job rows.
 *
 * Per-row failures are collected rather than thrown: one malformed row must not
 * stall the batch, which is the failure mode that made the old pipeline need
 * manual requeueing.
 */
export async function ingestJobs(rows: FeedRow[]): Promise<IngestResult> {
  const result: IngestResult = {
    seen: rows.length,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    failures: [],
    changes: [],
    detailsWritten: 0,
  };

  // ── 1. Normalise, collecting failures ──────────────────────────────────
  const candidates: {
    dedupeKey: string;
    contentHash: string;
    payload: JobPayload;
    detail: JobDetailPayload | null;
  }[] = [];

  // Organisations are resolved for the whole batch first: the same body appears
  // on dozens of rows, and looking each one up separately would be dozens of
  // round trips to learn the same id.
  const orgIds = await resolveOrganizations(
    rows.map((row) => toText(row.organization) ?? toText(row.department)),
  );

  for (const row of rows) {
    try {
      const { dedupeKey, payload } = toJobPayload(row, (name) => orgIds.get(name));

      const detailPayload = toJobDetailPayload(row);
      const detail = hasDetailContent(detailPayload) ? detailPayload : null;

      // The fee table, the vacancy breakdown and the pay prose are the
      // fallbacks for the card's figures. The old page did this arithmetic
      // inline on every render; all three are properties of the row.
      //
      // Only when the typed column is empty: a stated count is the
      // notification's own headline figure, and a breakdown table that lists
      // some of the posts would undercount it.
      //
      // Salary is the same rule with one extra step. `toSalary` has already
      // dropped a pay-matrix level read as pay — "Level-2 in 7th CPC Pay
      // Matrix; Initial Pay Rs. 19,900/-" arrives as `salary_min = 2` and
      // becomes null — and `salary_text` is the sentence it was misread from,
      // so the real ₹19,900 is still there to be read back. The detail page
      // already does this at render time, but only it has `salary_text`: the
      // listing cards and the JobPosting JSON-LD read the typed columns alone,
      // so the recovered figure has to be written into them here.
      const payloadWithFallbacks: JobPayload = {
        ...payload,
        application_fee: payload.application_fee ?? feeFromTable(row),
        vacancies: payload.vacancies ?? vacanciesFromTable(row),
        ...salaryWithFallback(payload, detailPayload.salary_text ?? null),
      };

      candidates.push({
        dedupeKey,
        // The detail half is inside the hash, so a notification that gains a
        // selection process without touching any card field still counts as
        // changed. Leaving it out would mean the cold table only ever caught up
        // when something hot happened to change on the same row.
        //
        // Adding it also invalidates every existing hash once, which is what
        // backfills `job_details` for rows already in the table: the first run
        // after this ships rewrites everything, and every run after that
        // writes nothing.
        contentHash: hashContent({ ...payloadWithFallbacks, detail }),
        payload: payloadWithFallbacks,
        detail,
      });
    } catch (error) {
      result.failed += 1;
      result.failures.push({
        sourceKey: toText(row.source_url) ?? toText(row.title),
        error: error instanceof Error ? error.message : String(error),
        payload: row,
      });
    }
  }

  if (candidates.length === 0) return result;

  const db = adminDb();

  // ── 2. What do we already have? ────────────────────────────────────────
  // One query for the whole batch. It used to name two columns — the key and
  // the hash — which was enough to answer "did this row change?" but not "what
  // changed?", so the answer was computed and thrown away on every run.
  //
  // The watched columns are added to that same round trip rather than fetched
  // in a second one. Six extra narrow columns over a batch of ~450 rows is
  // roughly 50 kB per run against a 5 GB monthly ceiling, and it is on the
  // ingest path, which runs hourly — not on the traffic path, which is the
  // distinction this whole architecture turns on.
  const { data: existingRows, error: readError } = await db
    .from("jobs")
    .select(CHANGE_SELECT)
    .in(
      "dedupe_key",
      candidates.map((c) => c.dedupeKey),
    );

  if (readError) throw new Error(`ingestJobs: ${readError.message}`);

  const existing = new Map(existingRows.map((r) => [r.dedupe_key, r]));

  // ── 3. Partition ───────────────────────────────────────────────────────
  const changed = candidates.filter((c) => {
    const known = existing.get(c.dedupeKey);
    if (known === undefined) return true; // new
    if (known.content_hash === c.contentHash) {
      result.unchanged += 1;
      return false;
    }
    return true;
  });

  for (const c of changed) {
    const before = existing.get(c.dedupeKey);
    if (before) {
      result.updated += 1;
      // Only for rows that already existed. An insert has no "before", and
      // reporting a new listing's first closing date as a change would put
      // "Last date set to 15 Sep" on every job the day it appears.
      result.changes.push(...diffWatched(c.dedupeKey, before, toComparable(c.payload)));
    } else {
      result.inserted += 1;
    }
  }

  if (changed.length === 0) return result;

  // ── 4. Write only what changed ─────────────────────────────────────────
  // Inserts and updates are separate operations, and the reason is `slug`.
  // A slug is a permanent public identifier: it is in the sitemap, in Google's
  // index, and in whatever people have shared. Recomputing it from the title on
  // every sync would silently 404 every inbound link the first time someone
  // fixed a typo in a job title. So it is written once, on insert, and never
  // touched again — an update sends the payload without it.
  const inserts = changed.filter((c) => !existing.has(c.dedupeKey));
  const updates = changed.filter((c) => existing.has(c.dedupeKey));

  if (inserts.length > 0) {
    const slugs = await uniqueSlugs(
      "jobs",
      inserts.map((c) => toSlug(c.payload.title)),
    );

    // Zipped rather than indexed: `slugs[i]` is `string | undefined` under
    // noUncheckedIndexedAccess, and the alternatives are a cast or a `!`, both
    // of which this codebase bans for good reason.
    const rows = inserts.map((c, i) => ({
      candidate: c,
      slug: slugs[i] ?? toSlug(c.payload.title),
    }));

    const { error } = await db.from("jobs").insert(
      rows.map(({ candidate, slug }) => ({
        ...candidate.payload,
        slug,
        dedupe_key: candidate.dedupeKey,
        content_hash: candidate.contentHash,
      })),
    );
    if (error) throw new Error(`ingestJobs insert: ${error.message}`);
  }

  for (const c of updates) {
    const { error } = await db
      .from("jobs")
      .update({ ...c.payload, content_hash: c.contentHash })
      .eq("dedupe_key", c.dedupeKey);
    if (error) throw new Error(`ingestJobs update: ${error.message}`);
  }

  // ── 5. The cold half ───────────────────────────────────────────────────
  result.detailsWritten = await writeJobDetails(
    changed.flatMap((c) => (c.detail ? [{ dedupeKey: c.dedupeKey, detail: c.detail }] : [])),
  );

  return result;
}

/**
 * Writes `job_details` for rows that have just been written.
 *
 * After the job rows, never before: `job_details.job_id` references `jobs`, so
 * the parent has to exist. Ingest speaks in dedupe keys and the table speaks in
 * job ids, so one query resolves between them for the whole batch — the same
 * shape as `recordJobChanges`, for the same reason.
 *
 * Failure is reported and stepped over rather than thrown. A job whose cold
 * half did not land still renders: title, deadline, eligibility, the apply
 * link. Throwing here would fail a batch of jobs that were successfully written
 * seconds earlier, to protect the less important half of the row.
 */
async function writeJobDetails(
  entries: { dedupeKey: string; detail: JobDetailPayload }[],
): Promise<number> {
  if (entries.length === 0) return 0;

  const db = adminDb();

  const { data: rows, error: lookupError } = await db
    .from("jobs")
    .select("id, dedupe_key")
    .in("dedupe_key", [...new Set(entries.map((e) => e.dedupeKey))]);

  if (lookupError) {
    console.error(`[sync] writeJobDetails lookup: ${lookupError.message}`);
    return 0;
  }

  const idByKey = new Map(rows.map((r) => [r.dedupe_key, r.id]));

  const payload = entries.flatMap((entry) => {
    const jobId = idByKey.get(entry.dedupeKey);
    if (!jobId) return [];
    return [{ ...entry.detail, job_id: jobId, updated_at: new Date().toISOString() }];
  });

  if (payload.length === 0) return 0;

  // Upsert on the primary key: a job that already has a detail row gets it
  // replaced, which is what a re-scrape of an amended notification means.
  const { error } = await db.from("job_details").upsert(payload, { onConflict: "job_id" });

  if (error) {
    console.error(`[sync] writeJobDetails: ${error.message}`);
    return 0;
  }

  return payload.length;
}

/**
 * Records what changed, after the rows themselves have been written.
 *
 * Separate from `ingestJobs` and called after it, in that order deliberately:
 * `job_changes.job_id` references `jobs`, so the row has to exist first. It
 * also means a failure to record history cannot cost you the history's subject.
 *
 * Failure is reported, never thrown. A missing changelog entry is a gap in a
 * feature; a thrown error here would roll the whole ingest run into the failure
 * path and lose the batch of jobs that was successfully written seconds ago.
 * The changelog is the less important half of this transaction and is treated
 * that way.
 */
export async function recordJobChanges(
  changes: JobChange[],
  syncRunId: string | null,
): Promise<{ written: number; error: string | null }> {
  if (changes.length === 0) return { written: 0, error: null };

  const db = adminDb();

  // The diff speaks in dedupe keys, because that is the identity ingestion
  // works in; the table speaks in job ids, because that is what a page joins
  // on. One query for the whole batch resolves between them.
  const { data: rows, error: lookupError } = await db
    .from("jobs")
    .select("id, dedupe_key")
    .in("dedupe_key", [...new Set(changes.map((c) => c.dedupeKey))]);

  if (lookupError) return { written: 0, error: lookupError.message };

  const idByKey = new Map(rows.map((r) => [r.dedupe_key, r.id]));

  const payload = changes.flatMap((c) => {
    const jobId = idByKey.get(c.dedupeKey);
    // A key with no row means the update that produced this diff did not land.
    // Dropping the entry is right: a changelog line pointing at nothing is
    // worse than a missing one.
    if (!jobId) return [];
    return [
      {
        job_id: jobId,
        field: c.field,
        old_value: c.oldValue,
        new_value: c.newValue,
        sync_run_id: syncRunId,
      },
    ];
  });

  if (payload.length === 0) return { written: 0, error: null };

  const { error } = await db.from("job_changes").insert(payload);
  if (error) return { written: 0, error: error.message };

  return { written: payload.length, error: null };
}
