import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import type { QueryData } from "@supabase/supabase-js";

import { BUILD_SENTINEL_SLUG, slugsForBuild } from "../build-params";
import { publicDb } from "../clients";
import { decodeCursor, toPage, type Page, PAGE_SIZE } from "../cursor";
import { unwrap, unwrapMaybe } from "../errors";
import { SEARCH_CONFIG, tags } from "../tags";
import type { Database } from "../database.types";

type UpdateCategory = Database["public"]["Enums"]["update_category"];

/**
 * Exam update reads.
 *
 * This was the largest table in the old project — 39 MB across 5,336 rows,
 * almost all of it five JSONB columns that only the detail page renders. The
 * card select below touches none of them.
 */

const UPDATE_CARD_SELECT = `
  id, slug, title, category, summary, tags,
  published_date, published_at,
  exam:exams ( slug, name, short_name ),
  organization:organizations ( slug, name, short_name, logo_path )
` as const;

const UPDATE_DETAIL_SELECT = `
  id, slug, title, category, summary, tags,
  published_date, published_at, scraped_at, source_url,
  job_id, job_link_state,
  exam:exams ( slug, name, short_name ),
  organization:organizations ( slug, name, short_name, logo_path, website ),
  detail:exam_update_details (
    body, sections, overview, important_dates, download_links, related_articles
  )
` as const;

const cardQuery = () => publicDb().from("exam_updates").select(UPDATE_CARD_SELECT);
const detailQuery = () => publicDb().from("exam_updates").select(UPDATE_DETAIL_SELECT);

export type ExamUpdateCard = QueryData<ReturnType<typeof cardQuery>>[number];
export type ExamUpdateDetail = QueryData<ReturnType<typeof detailQuery>>[number];

export interface UpdateListOptions {
  cursor?: string | undefined;
  limit?: number | undefined;
  category?: UpdateCategory | undefined;
  examSlug?: string | undefined;
  /**
   * Full-text search term. Folded in here rather than living in a separate
   * `searchExamUpdates`, so search paginates through the same cursor path as
   * every other filter.
   *
   * There *was* a separate function. It was written, indexed and
   * contract-tested, and its only caller was the test — /updates had no search
   * field at all. A second query path over one table is how the equivalent bug
   * on /jobs survived four modules: the test asserted the query was bounded
   * and named its columns, both of which stayed true of a query nothing used.
   */
  query?: string | undefined;
  /** Newest first by default; `oldest` walks a story from its beginning. */
  sort?: UpdateSort | undefined;
}

export type UpdateSort = "newest" | "oldest";

export function toUpdateSort(value: string | undefined): UpdateSort {
  return value === "oldest" ? "oldest" : "newest";
}

export async function listExamUpdates(
  options: UpdateListOptions = {},
): Promise<Page<ExamUpdateCard>> {
  "use cache";
  cacheLife("feed");
  cacheTag(tags.examUpdateList());

  const limit = options.limit ?? PAGE_SIZE.list;
  const cursor = decodeCursor(options.cursor);
  const ascending = (options.sort ?? "newest") === "oldest";

  let query = cardQuery()
    .eq("is_published", true)
    .order("published_at", { ascending })
    .order("id", { ascending })
    .limit(limit + 1);

  if (cursor) {
    // The comparison follows the sort direction: resuming a descending page
    // with `gt` would page backwards through rows already shown.
    const op = ascending ? "gt" : "lt";
    query = query.or(
      `published_at.${op}.${cursor.sortKey},` +
        `and(published_at.eq.${cursor.sortKey},id.${op}.${cursor.id})`,
    );
  }
  if (options.category) query = query.eq("category", options.category);
  if (options.examSlug) query = query.eq("exams.slug", options.examSlug);

  // A single character is treated as no filter rather than as a search that
  // matches nothing: it is almost always a keystroke on the way to a real
  // term, and emptying the page mid-typing reads as breakage.
  const term = options.query?.trim() ?? "";
  if (term.length >= 2) {
    query = query.textSearch("search_vector", term, {
      config: SEARCH_CONFIG,
      type: "websearch",
    });
  }

  const rows = unwrap("listExamUpdates", await query);

  return toPage(rows, limit, (row) => ({ sortKey: row.published_at, id: row.id }));
}

export async function getExamUpdateBySlug(slug: string): Promise<ExamUpdateDetail | null> {
  "use cache";
  cacheLife("content");
  cacheTag(tags.examUpdate(slug));

  // See `getJobBySlug` — the build-time sentinel resolves to null without a
  // query, so the placeholder page renders a 404 instead of failing the build.
  if (slug === BUILD_SENTINEL_SLUG) return null;

  return unwrapMaybe(
    "getExamUpdateBySlug",
    await detailQuery().eq("slug", slug).eq("is_published", true).maybeSingle(),
  );
}

/**
 * Slugs for `generateStaticParams`, uncached and failure-tolerant.
 *
 * Deliberately separate from `listExamUpdateSlugs`; the reasoning lives in
 * `src/lib/db/build-params.ts`, next to the sentinel it returns. `/updates/[slug]`
 * previously called the cached query directly, which is what turned an
 * unreachable database into a failed build rather than a degraded one.
 */
export async function listExamUpdateSlugsForBuild(): Promise<{ slug: string }[]> {
  return slugsForBuild("listExamUpdateSlugsForBuild", async () => {
    const { data, error } = await publicDb()
      .from("exam_updates")
      .select("slug")
      .eq("is_published", true)
      .order("updated_at", { ascending: false })
      .limit(20000);

    if (error) throw error;
    return data;
  });
}

export async function listExamUpdateSlugs(): Promise<{ slug: string; updated_at: string }[]> {
  "use cache";
  cacheLife("feed");
  cacheTag(tags.examUpdateList(), tags.sitemap());

  // Caught here, not by the caller — see `listJobSlugs` for why a rejection
  // inside a `"use cache"` scope cannot be handled from outside it.
  try {
    return unwrap(
      "listExamUpdateSlugs",
      await publicDb()
        .from("exam_updates")
        .select("slug, updated_at")
        .eq("is_published", true)
        .order("updated_at", { ascending: false })
        .limit(20000),
    );
  } catch (error) {
    console.warn(
      "[listExamUpdateSlugs] Unreachable; sitemap omits update pages this cache window.",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

/**
 * Updates attached to a job.
 *
 * On the old project this was a title-similarity fallback that scanned ~44 kB
 * per job page, because `job_id` was populated on 3 rows out of 3,373. It is a
 * foreign-key lookup now, resolved once at ingest — see the `job_link_state`
 * column and its CHECK constraint in migration 0006.
 */
export async function listUpdatesForJob(
  jobId: string,
  limit: number = PAGE_SIZE.rail,
): Promise<ExamUpdateCard[]> {
  "use cache";
  cacheLife("content");
  cacheTag(tags.examUpdateList());

  return unwrap(
    "listUpdatesForJob",
    await cardQuery()
      .eq("is_published", true)
      .eq("job_id", jobId)
      .order("published_at", { ascending: false })
      .limit(limit),
  );
}

/**
 * Download links from the updates attached to a job.
 *
 * The admit card, the answer key, the result — the documents somebody visiting
 * a job page a month after applying is actually looking for. They live on the
 * update rows, so the job page has no way to reach them without this.
 *
 * Two things keep it honest. It selects one column from the cold table rather
 * than the whole detail row, and it is bounded at five updates — this runs on a
 * statically generated page, so it costs nothing per view, but an unbounded
 * read is the habit rather than the number.
 */
export interface UpdateLinks {
  title: string;
  category: UpdateCategory;
  links: { label: string; url: string }[];
}

export async function listUpdateLinksForJob(
  jobId: string,
  limit: number = PAGE_SIZE.rail,
): Promise<UpdateLinks[]> {
  "use cache";
  cacheLife("content");
  cacheTag(tags.examUpdateList());

  const rows = unwrap(
    "listUpdateLinksForJob",
    await publicDb()
      .from("exam_updates")
      .select("title, category, detail:exam_update_details ( download_links )")
      .eq("is_published", true)
      .eq("job_id", jobId)
      .order("published_at", { ascending: false })
      .limit(Math.min(limit, 5)),
  );

  return rows.flatMap((row) => {
    const links = toDownloadLinks(row.detail?.download_links);
    return links.length === 0 ? [] : [{ title: row.title, category: row.category, links }];
  });
}

/** Narrows the stored jsonb. Ingest writes `{label, url}`; anything older or
 *  hand-edited is skipped rather than rendered as an empty row. */
function toDownloadLinks(value: unknown): { label: string; url: string }[] {
  if (!Array.isArray(value)) return [];

  const out: { label: string; url: string }[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const url = record.url ?? record.href;
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) continue;
    const label = record.label ?? record.text ?? record.title;
    out.push({ label: typeof label === "string" && label !== "" ? label : "Download", url });
  }
  return out.slice(0, 8);
}
