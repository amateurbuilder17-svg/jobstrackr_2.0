import type { Database } from "@/lib/db/database.types";
import {
  toFeeRows,
  toImportantDates,
  toOverview,
  toSteps,
  toVacancyTable,
  maxFee,
} from "@/lib/jobs/detail-shape";
import { toUrl } from "./links";
import { toText } from "./normalize";

/**
 * The cold half of a job, built from a feed row.
 *
 * `job_details` has been in the schema since Module 1 and in the detail
 * page's select since Module 5, and nothing has ever written to it. The page
 * asked for eleven columns of prose and JSONB, got eleven nulls, and rendered
 * a job page with none of what the notification actually said — which read as
 * a thin design rather than as the missing writer it was.
 *
 * Two callers, deliberately the same function:
 *
 *   - the ingestion worker, on every run;
 *   - the backfill script, over the old project's `job_metadata` blob.
 *
 * The old column names are accepted alongside the new ones for exactly that
 * reason. A backfill that normalises differently from the worker produces two
 * populations of rows that render differently, and the difference only shows up
 * on whichever pages nobody checked.
 */

type DetailInsert = Database["public"]["Tables"]["job_details"]["Insert"];

/** Everything but `job_id`, which the caller supplies once the job row exists. */
export type JobDetailPayload = Omit<DetailInsert, "job_id" | "updated_at">;

type Row = Record<string, unknown>;

/** First present value among several possible column names. */
function field(row: Row, ...names: string[]): unknown {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

/**
 * The old pipeline nested everything under one `job_metadata` blob. Reading
 * through it transparently is what lets the backfill hand raw old rows to the
 * same function the worker uses.
 */
function merged(row: Row): Row {
  const meta = row.job_metadata ?? row.metadata;
  if (typeof meta === "object" && meta !== null && !Array.isArray(meta)) {
    return { ...(meta as Row), ...row };
  }
  if (typeof meta === "string") {
    try {
      const parsed: unknown = JSON.parse(meta);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return { ...(parsed as Row), ...row };
      }
    } catch {
      // Not JSON. The typed columns below still apply.
    }
  }
  return row;
}

export function toJobDetailPayload(rawRow: Row): JobDetailPayload {
  const row = merged(rawRow);

  const importantDates = toImportantDates(
    field(row, "important_dates", "importantDates", "dates"),
  );
  const fees = toFeeRows(field(row, "application_fees", "applicationFees", "fees"));
  const vacancyTable = toVacancyTable(
    field(row, "vacancies_detail", "vacancyDetail", "vacancy_breakdown", "post_details"),
  );
  const steps = toSteps(field(row, "selection_process", "selectionProcess", "selection"));
  const overview = toOverview(field(row, "overview", "summary_table", "quick_info"));

  return {
    description: toText(field(row, "description", "job_description", "about")),
    eligibility_text: toText(
      field(row, "eligibility_text", "eligibility", "eligibility_criteria"),
    ),
    experience_text: toText(field(row, "experience_text", "experience")),

    // Normalised and blocklisted at write time. The old page carried the
    // blocklist in the renderer and applied it on every view; see `links.ts`.
    apply_link: toUrl(
      field(row, "apply_link", "applyLink", "apply_online", "application_link"),
    ),
    official_website: toUrl(field(row, "official_website", "website", "officialWebsite")),
    notification_pdf: toUrl(
      field(row, "notification_pdf", "notificationPdf", "notification", "pdf_link"),
    ),

    salary_text: toText(field(row, "salary_text", "salaryText", "pay_scale", "salary_details")),
    age_limit_text: toText(field(row, "age_limit_text", "ageLimitText", "age_limit")),

    // Empty arrays are written as null. A column holding `[]` renders as an
    // empty section with a heading and nothing under it, and `is not null` is
    // the natural way to ask whether there is anything to show.
    important_dates: importantDates.length > 0 ? importantDates : null,
    application_fees: fees.length > 0 ? fees : null,
    vacancies_detail: vacancyTable,
    selection_process: steps.length > 0 ? steps : null,
    overview: overview.length > 0 ? overview : null,

    // `raw` stays null. It exists for parser forensics, and the temptation is
    // to fill it "just in case" — but that is the old project's 6 kB-per-row
    // JSONB habit, and 5,800 rows of duplicated blob is 35 MB against a 500 MB
    // ceiling. Rows that fail to parse are already captured, with their whole
    // payload, in `sync_dead_letter`.
    raw: null,
    eligibility_profile: null,
  };
}

/**
 * Whether a payload says anything at all.
 *
 * A feed row with no detail fields would otherwise write a row of eleven nulls
 * per job — real storage, a real index entry and a real `updated_at` churning
 * on every run, to represent the absence of information.
 */
export function hasDetailContent(payload: JobDetailPayload): boolean {
  return Object.values(payload).some((value) => value !== null);
}

/**
 * The application fee, when the typed column is empty but the fee table is not.
 *
 * Returned separately rather than folded into the detail payload because it
 * belongs to `jobs`, not `job_details` — the card renders it, and a card query
 * must never reach into the cold table.
 */
export function feeFromTable(rawRow: Row): number | null {
  const row = merged(rawRow);
  return maxFee(toFeeRows(field(row, "application_fees", "applicationFees", "fees")));
}
