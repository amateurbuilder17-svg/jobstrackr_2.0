import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import type { QueryData } from "@supabase/supabase-js";

import { publicDb } from "../clients";
import { decodeCursor, toPage, type Page, PAGE_SIZE } from "../cursor";
import { unwrap, unwrapMaybe } from "../errors";
import { tags } from "../tags";
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
}

export async function listExamUpdates(
  options: UpdateListOptions = {},
): Promise<Page<ExamUpdateCard>> {
  "use cache";
  cacheLife("feed");
  cacheTag(tags.examUpdateList());

  const limit = options.limit ?? PAGE_SIZE.list;
  const cursor = decodeCursor(options.cursor);

  let query = cardQuery()
    .eq("is_published", true)
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (cursor) {
    query = query.or(
      `published_at.lt.${cursor.sortKey},` +
        `and(published_at.eq.${cursor.sortKey},id.lt.${cursor.id})`,
    );
  }
  if (options.category) query = query.eq("category", options.category);
  if (options.examSlug) query = query.eq("exams.slug", options.examSlug);

  const rows = unwrap("listExamUpdates", await query);

  return toPage(rows, limit, (row) => ({ sortKey: row.published_at, id: row.id }));
}

export async function getExamUpdateBySlug(slug: string): Promise<ExamUpdateDetail | null> {
  "use cache";
  cacheLife("content");
  cacheTag(tags.examUpdate(slug));

  return unwrapMaybe(
    "getExamUpdateBySlug",
    await detailQuery().eq("slug", slug).eq("is_published", true).maybeSingle(),
  );
}

export async function listExamUpdateSlugs(): Promise<{ slug: string; updated_at: string }[]> {
  "use cache";
  cacheLife("feed");
  cacheTag(tags.examUpdateList(), tags.sitemap());

  return unwrap(
    "listExamUpdateSlugs",
    await publicDb()
      .from("exam_updates")
      .select("slug, updated_at")
      .eq("is_published", true)
      .order("updated_at", { ascending: false })
      .limit(20000),
  );
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

export async function searchExamUpdates(
  term: string,
  limit: number = PAGE_SIZE.list,
): Promise<ExamUpdateCard[]> {
  "use cache";
  cacheLife("feed");
  cacheTag(tags.examUpdateList());

  const trimmed = term.trim();
  if (trimmed.length < 2) return [];

  return unwrap(
    "searchExamUpdates",
    await cardQuery()
      .eq("is_published", true)
      .textSearch("search_vector", trimmed, { config: "public.jt_search", type: "websearch" })
      .order("published_at", { ascending: false })
      .limit(limit),
  );
}
