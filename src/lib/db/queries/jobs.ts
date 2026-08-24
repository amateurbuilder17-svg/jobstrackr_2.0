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
const JOB_CARD_SELECT = `
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
  cacheLife("days");
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
  cacheLife("days");
  cacheTag(tags.job(slug));

  return unwrapMaybe(
    "getJobBySlug",
    await detailQuery().eq("slug", slug).eq("status", "published").maybeSingle(),
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
  cacheLife("days");
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
  cacheLife("days");
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

/**
 * Full-text search over published jobs.
 *
 * `websearch_to_tsquery` accepts what people actually type — quoted phrases,
 * `or`, a leading minus — instead of erroring on syntax the way `to_tsquery`
 * does. Ranking is left to the index rather than re-sorted in JS.
 */
export async function searchJobs(
  term: string,
  limit: number = PAGE_SIZE.list,
): Promise<JobCard[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(tags.jobList());

  const trimmed = term.trim();
  if (trimmed.length < 2) return [];

  return unwrap(
    "searchJobs",
    await cardQuery()
      .eq("status", "published")
      .textSearch("search_vector", trimmed, {
        config: "public.jt_search",
        type: "websearch",
      })
      .order("published_at", { ascending: false })
      .limit(limit),
  );
}
