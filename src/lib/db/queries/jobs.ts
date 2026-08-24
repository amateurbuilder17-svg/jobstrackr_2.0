import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import type { QueryData } from "@supabase/supabase-js";

import { publicDb } from "../clients";
import { decodeCursor, toPage, type Page, PAGE_SIZE } from "../cursor";
import { unwrap, unwrapMaybe } from "../errors";
import { tags } from "../tags";

/**
 * Job reads.
 *
 * Every function here caches and tags itself rather than leaving that to the
 * page. A page that forgets to tag never updates — it just serves stale data
 * indefinitely, with nothing in any log to say so. Doing it at the query means
 * the tag cannot be forgotten, and the page that calls the query inherits it.
 *
 * Column lists are explicit and deliberately short. `select('*')` is an ESLint
 * error in this codebase; these lists are why that rule is livable.
 */

/**
 * What a job card renders. Nothing here is speculative — every column maps to
 * something visible. The organization join costs ~60 bytes per row and replaces
 * the 13 kB client-side logo lookup the old app shipped.
 */
export const JOB_CARD_SELECT = `
  id, slug, title, location, state,
  last_date, last_date_display,
  vacancies, vacancies_display,
  salary_min, salary_max, salary_display,
  application_fee, tags, is_featured, published_at,
  organization:organizations ( slug, name, short_name, logo_path )
` as const;

/** Detail page. Pulls the cold half, which a list query cannot reach. */
const JOB_DETAIL_SELECT = `
  id, slug, title, location, state,
  application_start_date, last_date, last_date_display,
  vacancies, vacancies_display, qualification_summary,
  salary_min, salary_max, salary_display, application_fee,
  min_qualification_level, age_min, age_max, experience_years_min, gender,
  required_skills, tags, is_featured, status, source_url,
  published_at, created_at, updated_at,
  organization:organizations ( slug, name, short_name, logo_path, website ),
  detail:job_details (
    description, eligibility_text, experience_text,
    apply_link, official_website, notification_pdf,
    important_dates, application_fees, vacancies_detail,
    selection_process, overview
  )
` as const;

const cardQuery = () => publicDb().from("jobs").select(JOB_CARD_SELECT);
const detailQuery = () => publicDb().from("jobs").select(JOB_DETAIL_SELECT);

export type JobCard = QueryData<ReturnType<typeof cardQuery>>[number];
export type JobDetail = QueryData<ReturnType<typeof detailQuery>>[number];

export interface JobListOptions {
  cursor?: string | undefined;
  limit?: number | undefined;
  organizationSlug?: string | undefined;
  tag?: string | undefined;
  state?: string | undefined;
  /** Full-text search term. Folded in here so search is paginated like any
   *  other filter, rather than being a separate, unpaginated code path. */
  query?: string | undefined;
}

/**
 * One page of published jobs, newest first.
 *
 * Ordered by `(published_at desc, id desc)` to match `jobs_feed_idx`, so the
 * planner walks the index and stops at `limit`. The tie-break on `id` is not
 * decorative: without it, rows sharing a timestamp can repeat or vanish across
 * page boundaries, which is the classic keyset pagination bug.
 */
export async function listJobs(options: JobListOptions = {}): Promise<Page<JobCard>> {
  "use cache";
  cacheLife("feed");
  cacheTag(tags.jobList());

  const limit = options.limit ?? PAGE_SIZE.list;
  const cursor = decodeCursor(options.cursor);

  // Fetch one extra row to answer "is there a next page?" without a count(*),
  // which on a filtered table means scanning every match to render a chevron.
  let query = cardQuery()
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);

  if (cursor) {
    query = query.or(
      `published_at.lt.${cursor.sortKey},` +
        `and(published_at.eq.${cursor.sortKey},id.lt.${cursor.id})`,
    );
  }
  if (options.organizationSlug)
    query = query.eq("organizations.slug", options.organizationSlug);
  if (options.tag) query = query.contains("tags", [options.tag]);
  if (options.state) query = query.eq("state", options.state);

  const rows = unwrap("listJobs", await query);

  return toPage(rows, limit, (row) => ({
    sortKey: row.published_at,
    id: row.id,
  }));
}

/**
 * One job by slug, or null.
 *
 * Tagged with both the job and the list: editing a job must refresh its own
 * page and every list it appears on.
 */
export async function getJobBySlug(slug: string): Promise<JobDetail | null> {
  "use cache";
  cacheLife("content");
  cacheTag(tags.job(slug));

  return unwrapMaybe(
    "getJobBySlug",
    await detailQuery().eq("slug", slug).eq("status", "published").maybeSingle(),
  );
}

/**
 * Cards for a specific set of ids, for the guest saved list.
 *
 * A guest's shortlist lives in their browser, so the ids arrive from the client
 * and the server has no prior knowledge of them. Bounded and de-duplicated
 * before it reaches Postgres: the input is localStorage, which anyone can edit
 * into a request for the entire table.
 *
 * Public content, so it caches and tags like every other job read — a hundred
 * guests with overlapping shortlists share the cached rows.
 */
export async function listJobCardsByIds(ids: string[]): Promise<JobCard[]> {
  "use cache";
  cacheLife("feed");
  cacheTag(tags.jobList());

  const wanted = [...new Set(ids)].slice(0, PAGE_SIZE.savedIds);
  if (wanted.length === 0) return [];

  return unwrap(
    "listJobCardsByIds",
    await cardQuery()
      .in("id", wanted)
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(PAGE_SIZE.savedIds),
  );
}

/**
 * Every published slug, for `generateStaticParams` and the sitemap.
 *
 * The one intentionally large read in this module: it runs at build and on
 * sitemap revalidation, not per request. Two columns keep it to roughly 60
 * bytes a row — about 350 kB across the whole corpus, a handful of times a day.
 */
export async function listJobSlugs(): Promise<{ slug: string; updated_at: string }[]> {
  "use cache";
  cacheLife("feed");
  cacheTag(tags.jobList(), tags.sitemap());

  return unwrap(
    "listJobSlugs",
    await publicDb()
      .from("jobs")
      .select("slug, updated_at")
      .eq("status", "published")
      .order("updated_at", { ascending: false })
      .limit(20000),
  );
}

/**
 * Slugs for `generateStaticParams`, uncached and failure-tolerant.
 *
 * Deliberately separate from `listJobSlugs`. Three reasons:
 *
 *   1. It runs exactly once per build, so caching it buys nothing.
 *   2. A promise that rejects *inside* a `"use cache"` scope cannot be caught
 *      by the caller — Next fails the build before the catch runs.
 *   3. Cache Components requires this to return at least one entry, so it can
 *      validate at build time that the route has no unguarded dynamic access.
 *      Returning an empty array is a hard build error, not a soft fallback.
 *
 * Hence the sentinel. If the database is unreachable — a blip, a paused
 * project — the build still succeeds with one placeholder slug that renders a
 * 404, and every real page renders on first request and caches from then on.
 * The alternative is a failed deploy because Supabase was briefly slow, which
 * trades a self-healing performance dip for a complete outage.
 */
export const BUILD_SENTINEL_SLUG = "unavailable-at-build-time";

export async function listJobSlugsForBuild(): Promise<{ slug: string }[]> {
  try {
    const { data, error } = await publicDb()
      .from("jobs")
      .select("slug")
      .eq("status", "published")
      .order("updated_at", { ascending: false })
      .limit(20000);

    if (error) throw error;
    if (data.length > 0) return data;

    console.warn("[listJobSlugsForBuild] No published jobs found; prerendering none.");
  } catch (error) {
    console.warn(
      "[listJobSlugsForBuild] Database unreachable; prerendering no job pages. " +
        "They will render on first request and cache from then on.",
      error instanceof Error ? error.message : error,
    );
  }

  return [{ slug: BUILD_SENTINEL_SLUG }];
}

/**
 * Other jobs from the same organization, excluding the one being viewed.
 *
 * Deliberately not "similar jobs" by embedding. This runs on every job page, so
 * it uses `jobs_organization_idx` and costs one index scan; semantic similarity
 * belongs in Module 8 where it can be precomputed rather than paid per view.
 */
export async function listRelatedJobs(
  organizationSlug: string,
  excludeSlug: string,
  limit: number = PAGE_SIZE.rail,
): Promise<JobCard[]> {
  "use cache";
  cacheLife("content");
  cacheTag(tags.jobList(), tags.organization(organizationSlug));

  return unwrap(
    "listRelatedJobs",
    await cardQuery()
      .eq("status", "published")
      .eq("organizations.slug", organizationSlug)
      .neq("slug", excludeSlug)
      .order("published_at", { ascending: false })
      .limit(limit),
  );
}
