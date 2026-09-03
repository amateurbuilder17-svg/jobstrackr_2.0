import "server-only";

import { createHash } from "node:crypto";

import { adminDb } from "@/lib/db/clients";
import type { Database, Json } from "@/lib/db/database.types";
import { toDateLinks, toImportantDates, toOverview } from "@/lib/jobs/detail-shape";
import { sectorTagsOf } from "@/lib/jobs/sectors";
import { UPDATE_CATEGORIES, type UpdateCategory } from "@/lib/updates/categories";
import { toUpdateSections } from "@/lib/updates/detail-shape";
import { toUrl } from "./links";
import { toDate, toSlug, toText } from "./normalize";
import { resolveOrganizations } from "./organizations";
import { uniqueSlugs } from "./slugs";

/**
 * Exam-update ingestion.
 *
 * `exam_updates` has carried a `dedupe_key` and a `content_hash` since Module 1
 * — columns that exist for exactly one purpose, an idempotent ingest path — and
 * nothing has ever written them. `/api/sync` accepted `kind: "exam_updates"`
 * and then called `ingestJobs` on the rows regardless, which would have turned
 * a batch of admit-card notices into a batch of malformed job listings.
 *
 * Same shape as the jobs worker and for the same reasons: hash first, write
 * only what changed, collect per-row failures instead of throwing.
 */

export type FeedRow = Record<string, unknown>;

type UpdateInsert = Database["public"]["Tables"]["exam_updates"]["Insert"];
type UpdatePayload = Omit<UpdateInsert, "dedupe_key" | "content_hash" | "slug">;
type DetailInsert = Database["public"]["Tables"]["exam_update_details"]["Insert"];
type DetailPayload = Omit<DetailInsert, "exam_update_id" | "updated_at">;

export interface UpdateIngestResult {
  seen: number;
  inserted: number;
  updated: number;
  unchanged: number;
  failed: number;
  detailsWritten: number;
  failures: { sourceKey: string | null; error: string; payload: FeedRow }[];
}

/** Category words the scrapers use, mapped onto the enum. */
const CATEGORY_ALIASES: Record<string, UpdateCategory> = {
  admitcard: "admit_card",
  admit_card: "admit_card",
  hallticket: "admit_card",
  call_letter: "admit_card",
  result: "result",
  results: "result",
  merit_list: "result",
  answerkey: "answer_key",
  answer_key: "answer_key",
  key: "answer_key",
  syllabus: "syllabus",
  exam_pattern: "syllabus",
  notification: "notification",
  recruitment: "notification",
  vacancy: "notification",
  latest: "notification",
  exam_date: "exam_date",
  examdate: "exam_date",
  date_sheet: "exam_date",
  cutoff: "cutoff",
  cut_off: "cutoff",
  merit: "cutoff",
  news: "news",
};

export function toUpdateCategory(value: unknown): UpdateCategory {
  const raw = toText(value)
    ?.toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!raw) return "news";
  if ((UPDATE_CATEGORIES as readonly string[]).includes(raw)) return raw as UpdateCategory;
  // `news` is the fallback rather than a guess, and that is the conservative
  // direction: a mislabelled admit card in the news bucket is findable, while
  // a news item labelled "result" is a false alarm for someone waiting on one.
  return CATEGORY_ALIASES[raw] ?? "news";
}

function hashContent(payload: Record<string, unknown>): string {
  const canonical = JSON.stringify(
    Object.keys(payload)
      .sort()
      .map((key) => [key, payload[key] ?? null]),
  );
  return createHash("sha256").update(canonical).digest("hex");
}

export function toUpdatePayload(
  row: FeedRow,
  organizationId: (name: string) => string | undefined,
): { dedupeKey: string; payload: UpdatePayload; detail: DetailPayload | null } {
  const title = toText(row.title);
  if (!title) throw new Error("title is required");

  const sourceUrl = toText(row.source_url) ?? toText(row.url);
  if (!sourceUrl) throw new Error("source_url is required");

  const dedupeKey = createHash("sha256")
    .update(`${sourceUrl}\n${title}`)
    .digest("hex")
    .slice(0, 32);

  const organisation = toText(row.organization) ?? toText(row.conducting_body);
  const publishedDate = toDate(row.published_date) ?? toDate(row.date);

  const importantDates = toImportantDates(row.important_dates);
  const overview = toOverview(row.overview);
  const sections = toSections(row.sections);
  // Download links and the links hiding in "Click here" date rows are one list
  // to a reader. The old page fetched them from two columns and merged them at
  // render; merging at write means the page reads one field.
  //
  // `official_links` is folded in for the same reason: the ExamUpdates tab
  // keeps the board's own result/admit-card page in a separate column from the
  // PDFs, and a reader wants both under one heading.
  const downloads = mergeLinks(
    [...toDownloadLinks(row.download_links), ...toDownloadLinks(row.official_links)],
    toDateLinks(row.important_dates),
  );

  const detail: DetailPayload = {
    // `full_text` is the sheet's name for it (UPDATE_COLUMNS in Config.gs).
    // Without it the article body is NULL on every row the live feed sends,
    // and the update page renders a heading with nothing under it.
    body: toText(row.body) ?? toText(row.content) ?? toText(row.full_text),
    sections: sections.length > 0 ? sections : null,
    overview: overview.length > 0 ? overview : null,
    important_dates: importantDates.length > 0 ? importantDates : null,
    download_links: downloads.length > 0 ? downloads : null,
    related_articles: null,
    raw: null,
  };

  return {
    dedupeKey,
    payload: {
      title,
      source_url: sourceUrl,
      category: toUpdateCategory(row.category),
      summary: toText(row.summary),
      // Derived, for the same reason jobs' tags are — see `sectorTagsOf`.
      //
      // The sheet's own tags were unusable in both of the shapes they arrived
      // in: 5,978 of 6,173 rows held the literal string "[]" (an array written
      // without being joined, since fixed in `toStringArray`), and the ~180
      // that held anything real held SEO keyword phrases — "IBPS SO Result
      // 2025", "Latest NTPC Jobs" — 751 distinct values across those rows,
      // nearly one per row. That groups nothing, restates the title, and puts
      // a different vocabulary in `tags` here than in `jobs.tags`.
      tags: sectorTagsOf({ title, organization: organisation }),
      published_date: publishedDate,
      published_at:
        toText(row.published_at) ?? (publishedDate ? `${publishedDate}T00:00:00Z` : null),
      organization_id: organisation ? (organizationId(organisation) ?? null) : null,
      is_published: true,
    },
    detail: Object.values(detail).some((v) => v !== null) ? detail : null,
  };
}

// Type aliases rather than interfaces, so they are assignable to `Json`. See
// the note at the top of `jobs/detail-shape.ts`.
// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type Section = { heading: string; content: string[] };

/**
 * The article, as headings and their lines.
 *
 * This used to read `record.content` through `toText`, which returns null for
 * an array — and an array of lines is the shape the scraper actually sends, and
 * the shape all 5,336 backfilled rows are stored in. Every section therefore
 * arrived here as `{heading, body: ""}`, and the page rendered a column of bare
 * headings.
 *
 * `toUpdateSections` is the renderer's own normaliser, so ingest and render
 * agree on the shape by construction rather than by two lists staying in step.
 * It also strips the source site's advert lines and decodes the entities, which
 * means a row written from now on needs no cleaning on the way out — the
 * renderer runs the same pass again over the old rows, and running it twice is
 * a no-op.
 */
function toSections(value: unknown): Section[] {
  const source = typeof value === "string" ? safeParse(value) : value;
  return toUpdateSections((source ?? null) as Json).map((section) => ({
    heading: section.heading,
    content: section.lines,
  }));
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type Download = { label: string; url: string };

function toDownloadLinks(value: unknown): Download[] {
  const source = typeof value === "string" ? safeParse(value) : value;
  if (!Array.isArray(source)) return [];

  const out: Download[] = [];
  for (const entry of source) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    // Blocked at write time — source sites put their own channel invites in
    // the same list as the notification PDFs. See `links.ts`.
    const url = toUrl(record.url ?? record.href ?? record.link);
    if (!url) continue;
    const label =
      toText(record.label) ?? toText(record.text) ?? toText(record.title) ?? "Download";
    out.push({ label, url });
  }
  return out;
}

function mergeLinks(a: Download[], b: { text: string; url: string }[]): Download[] {
  const seen = new Set<string>();
  const out: Download[] = [];
  for (const link of [...a, ...b.map((l) => ({ label: l.text, url: l.url }))]) {
    const url = toUrl(link.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ label: link.label, url });
  }
  return out.slice(0, 25);
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export async function ingestExamUpdates(rows: FeedRow[]): Promise<UpdateIngestResult> {
  const result: UpdateIngestResult = {
    seen: rows.length,
    inserted: 0,
    updated: 0,
    unchanged: 0,
    failed: 0,
    detailsWritten: 0,
    failures: [],
  };

  const orgIds = await resolveOrganizations(
    rows.map((row) => toText(row.organization) ?? toText(row.conducting_body)),
  );

  const candidates: {
    dedupeKey: string;
    contentHash: string;
    payload: UpdatePayload;
    detail: DetailPayload | null;
  }[] = [];

  for (const row of rows) {
    try {
      const { dedupeKey, payload, detail } = toUpdatePayload(row, (name) => orgIds.get(name));
      candidates.push({
        dedupeKey,
        contentHash: hashContent({ ...payload, detail }),
        payload,
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

  const { data: existingRows, error: readError } = await db
    .from("exam_updates")
    .select("id, dedupe_key, content_hash")
    .in(
      "dedupe_key",
      candidates.map((c) => c.dedupeKey),
    );

  if (readError) throw new Error(`ingestExamUpdates: ${readError.message}`);

  const existing = new Map(existingRows.map((r) => [r.dedupe_key, r]));

  const changed = candidates.filter((c) => {
    const known = existing.get(c.dedupeKey);
    if (known === undefined) return true;
    if (known.content_hash === c.contentHash) {
      result.unchanged += 1;
      return false;
    }
    return true;
  });

  if (changed.length === 0) return result;

  const inserts = changed.filter((c) => !existing.has(c.dedupeKey));
  const updates = changed.filter((c) => existing.has(c.dedupeKey));

  if (inserts.length > 0) {
    // The slug is the public identifier and is written once, never
    // recomputed — the same rule the jobs worker follows, for the same reason:
    // regenerating it from a corrected title 404s every inbound link.
    const slugs = await uniqueSlugs(
      "exam_updates",
      inserts.map((c) => toSlug(c.payload.title)),
    );

    const rowsToInsert = inserts.map((c, i) => ({
      ...c.payload,
      slug: slugs[i] ?? toSlug(c.payload.title),
      dedupe_key: c.dedupeKey,
      content_hash: c.contentHash,
    }));

    const { error } = await db.from("exam_updates").insert(rowsToInsert);
    if (error) throw new Error(`ingestExamUpdates insert: ${error.message}`);
    result.inserted = inserts.length;
  }

  for (const c of updates) {
    const { error } = await db
      .from("exam_updates")
      .update({ ...c.payload, content_hash: c.contentHash })
      .eq("dedupe_key", c.dedupeKey);
    if (error) throw new Error(`ingestExamUpdates update: ${error.message}`);
    result.updated += 1;
  }

  result.detailsWritten = await writeUpdateDetails(
    changed.flatMap((c) => (c.detail ? [{ dedupeKey: c.dedupeKey, detail: c.detail }] : [])),
  );

  return result;
}

/** As `writeJobDetails`: after the parent rows, and never fatal. */
async function writeUpdateDetails(
  entries: { dedupeKey: string; detail: DetailPayload }[],
): Promise<number> {
  if (entries.length === 0) return 0;

  const db = adminDb();

  const { data: rows, error: lookupError } = await db
    .from("exam_updates")
    .select("id, dedupe_key")
    .in("dedupe_key", [...new Set(entries.map((e) => e.dedupeKey))]);

  if (lookupError) {
    console.error(`[sync] writeUpdateDetails lookup: ${lookupError.message}`);
    return 0;
  }

  const idByKey = new Map(rows.map((r) => [r.dedupe_key, r.id]));

  const payload = entries.flatMap((entry) => {
    const id = idByKey.get(entry.dedupeKey);
    if (!id) return [];
    return [{ ...entry.detail, exam_update_id: id, updated_at: new Date().toISOString() }];
  });

  if (payload.length === 0) return 0;

  const { error } = await db
    .from("exam_update_details")
    .upsert(payload, { onConflict: "exam_update_id" });

  if (error) {
    console.error(`[sync] writeUpdateDetails: ${error.message}`);
    return 0;
  }

  return payload.length;
}
