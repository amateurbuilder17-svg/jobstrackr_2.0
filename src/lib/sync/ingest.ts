import "server-only";

import { createHash } from "node:crypto";

import { adminDb } from "@/lib/db/clients";
import type { Database } from "@/lib/db/database.types";
import { toDate, toInt, toSlug, toStringArray, toText } from "./normalize";

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
      vacancies: toInt(row.vacancies),
      vacancies_display: toText(row.vacancies_display),
      qualification_summary: toText(row.qualification_summary),
      salary_min: toInt(row.salary_min),
      salary_max: toInt(row.salary_max),
      salary_display: toText(row.salary_display),
      application_fee: toInt(row.application_fee),
      age_min: toInt(row.age_min),
      age_max: toInt(row.age_max),
      experience_years_min: toInt(row.experience_years_min),
      application_start_date: toDate(row.application_start_date),
      last_date: lastDate,
      // Kept as typed, because "TBD" is a real answer this column must carry
      // without the date column inventing one.
      last_date_display: toText(row.last_date_display),
      tags: toStringArray(row.tags),
    },
  };
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
  };

  // ── 1. Normalise, collecting failures ──────────────────────────────────
  const candidates: {
    dedupeKey: string;
    contentHash: string;
    payload: JobPayload;
  }[] = [];

  // Organisations are resolved for the whole batch first: the same body appears
  // on dozens of rows, and looking each one up separately would be dozens of
  // round trips to learn the same id.
  const orgIds = await resolveOrganizations(rows);

  for (const row of rows) {
    try {
      const { dedupeKey, payload } = toJobPayload(row, (name) => orgIds.get(name));
      candidates.push({ dedupeKey, contentHash: hashContent(payload), payload });
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
  // Two columns for the whole batch, served by a covering index.
  const { data: existingRows, error: readError } = await db
    .from("jobs")
    .select("dedupe_key, content_hash")
    .in(
      "dedupe_key",
      candidates.map((c) => c.dedupeKey),
    );

  if (readError) throw new Error(`ingestJobs: ${readError.message}`);

  const existing = new Map(existingRows.map((r) => [r.dedupe_key, r.content_hash]));

  // ── 3. Partition ───────────────────────────────────────────────────────
  const changed = candidates.filter((c) => {
    const known = existing.get(c.dedupeKey);
    if (known === undefined) return true; // new
    if (known === c.contentHash) {
      result.unchanged += 1;
      return false;
    }
    return true;
  });

  for (const c of changed) {
    if (existing.has(c.dedupeKey)) result.updated += 1;
    else result.inserted += 1;
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
    const slugs = await uniqueSlugs(inserts.map((c) => toSlug(c.payload.title)));

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

  return result;
}

/**
 * Makes a batch of base slugs unique, against both the database and each other.
 *
 * One query for the whole batch rather than one per row. The suffix is a
 * counter rather than a hash because these end up in URLs people read, and
 * `ssc-cgl-2026-2` is a better thing to share than `ssc-cgl-2026-a3f9c1`.
 */
async function uniqueSlugs(bases: string[]): Promise<string[]> {
  const db = adminDb();

  const { data, error } = await db
    .from("jobs")
    .select("slug")
    .in("slug", bases)
    .limit(bases.length);

  if (error) throw new Error(`uniqueSlugs: ${error.message}`);

  const taken = new Set(data.map((r) => r.slug));

  return bases.map((base) => {
    // An empty base would produce "/jobs/" — fall back to something addressable
    // rather than writing a row nobody can reach.
    let candidate = base || "job";
    let n = 1;
    while (taken.has(candidate)) {
      n += 1;
      candidate = `${base || "job"}-${String(n)}`;
    }
    taken.add(candidate);
    return candidate;
  });
}

/**
 * Maps organisation names in a batch to ids, creating any that are new.
 *
 * The feed carries a body's name, not its id, and a name that does not exist
 * yet is normal — a new recruiting body appears every few weeks. Creating it is
 * better than dead-lettering every job it posts, which is what refusing would
 * amount to.
 *
 * Matched case-insensitively on the generated slug rather than on the name, so
 * "Staff Selection Commission" and "staff selection commission" are one body
 * rather than two.
 */
async function resolveOrganizations(rows: FeedRow[]): Promise<Map<string, string>> {
  const db = adminDb();

  const names = new Map<string, string>(); // slug → original name
  for (const row of rows) {
    const name = toText(row.organization) ?? toText(row.department);
    if (!name) continue;
    const slug = toSlug(name);
    if (slug) names.set(slug, name);
  }

  const out = new Map<string, string>(); // name → id
  if (names.size === 0) return out;

  const { data: existing, error } = await db
    .from("organizations")
    .select("id, slug")
    .in("slug", [...names.keys()]);

  if (error) throw new Error(`resolveOrganizations: ${error.message}`);

  const bySlug = new Map(existing.map((o) => [o.slug, o.id]));

  const missing = [...names.entries()].filter(([slug]) => !bySlug.has(slug));

  if (missing.length > 0) {
    const { data: created, error: createError } = await db
      .from("organizations")
      .insert(missing.map(([slug, name]) => ({ slug, name })))
      .select("id, slug");

    if (createError) throw new Error(`resolveOrganizations: ${createError.message}`);
    for (const o of created) bySlug.set(o.slug, o.id);
  }

  for (const [slug, name] of names) {
    const id = bySlug.get(slug);
    if (id) out.set(name, id);
  }
  return out;
}
