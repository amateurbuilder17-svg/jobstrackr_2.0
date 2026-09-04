import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import type { QueryData } from "@supabase/supabase-js";

import { BUILD_PRERENDER_LIMIT, BUILD_SENTINEL_SLUG, slugsForBuild } from "../build-params";
import { publicDb } from "../clients";
import { decodeCursor, toPage, type Page, PAGE_SIZE } from "../cursor";
import { unwrap, unwrapMaybe } from "../errors";
import { fetchAllRows } from "../paginate";
import { SEARCH_CONFIG, tags } from "../tags";
import type { Database } from "../database.types";
import { todayInIndia } from "@/lib/format/deadline";

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
  vacancies, vacancies_display, qualification_summary,
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
    salary_text, age_limit_text,
    apply_link, official_website, notification_pdf,
    important_dates, application_fees, vacancies_detail,
    selection_process, overview
  )
` as const;

const cardQuery = () => publicDb().from("jobs").select(JOB_CARD_SELECT);
const detailQuery = () => publicDb().from("jobs").select(JOB_DETAIL_SELECT);

export type JobCard = QueryData<ReturnType<typeof cardQuery>>[number];
export type JobDetail = QueryData<ReturnType<typeof detailQuery>>[number];

/**
 * How the list is ordered.
 *
 * `closing` is the default because the reader has a deadline: newest-first
 * buries a job closing tomorrow beneath one posted this morning that closes in
 * sixty days. It is only correct because `close_expired_jobs()` retires past
 * deadlines every ingest run, so `status = 'published'` means "still open" —
 * see migration 0016.
 */
export type JobSort = "closing" | "newest" | "vacancy";

export function toJobSort(value: string | undefined): JobSort {
  if (value === "newest") return "newest";
  if (value === "vacancy") return "vacancy";
  return "closing";
}

export interface JobListOptions {
  cursor?: string | undefined;
  limit?: number | undefined;
  organizationSlug?: string | undefined;
  tag?: string | undefined;
  sector?: string | undefined;
  /** Canonical state or union territory, matched against `location_state`. */
  state?: string | undefined;
  /** The post's stated minimum qualification, exactly. */
  level?: Database["public"]["Enums"]["qualification_level"] | undefined;
  /** The discipline the post requires. */
  stream?: Database["public"]["Enums"]["qualification_stream"] | undefined;
  sort?: JobSort | undefined;
  /** Full-text search term. Folded in here so search is paginated like any
   *  other filter, rather than being a separate, unpaginated code path. */
  query?: string | undefined;
}

/**
 * One page of open jobs.
 *
 * Backed by indexes so the planner walks it and stops at `limit`:
 *
 *   `closing` — `(last_date asc, id asc)`
 *   `newest`  — `(published_at desc, id desc)`
 *   `vacancy` — `(vacancies desc, id asc)`
 *
 * The tie-break on `id` is not decorative: without it, rows sharing a
 * sort key can repeat or vanish across page boundaries, which is the classic
 * keyset pagination bug.
 *
 * Only `published` rows appear, and since migration 0016 that genuinely means
 * "still open" — `close_expired_jobs()` retires past deadlines every ingest
 * run. Which is what makes an ascending sort on `last_date` show the next
 * deadline rather than the oldest expired one.
 */
export async function listJobs(options: JobListOptions = {}): Promise<Page<JobCard>> {
  "use cache";
  cacheLife("feed");
  cacheTag(tags.jobList());

  const limit = options.limit ?? PAGE_SIZE.list;
  const cursor = decodeCursor(options.cursor);
  const sort = options.sort ?? "closing";
  const column =
    sort === "closing" ? "last_date" : sort === "vacancy" ? "vacancies" : "published_at";
  const ascending = sort === "closing";

  // Fetch one extra row to answer "is there a next page?" without a count(*),
  // which on a filtered table means scanning every match to render a chevron.
  let query = cardQuery()
    .eq("status", "published")
    // ── Why the date is filtered here as well as by `close_expired_jobs()` ──
    //
    // The ordering above is only meaningful if `status = 'published'` really
    // does mean "still open", and nothing in the schema enforces that — it is
    // maintained by a function the ingest worker calls. So in the window
    // between a deadline passing and the next ingest run, an ascending sort on
    // `last_date` puts *expired* listings at the very top of "Closing soon",
    // which is the one row where being wrong is most visible.
    //
    // Not hypothetical: seeded locally, 14 of 240 published rows were already
    // past their date, and the home page led with six of them, every badge
    // reading "Closed". A row promising the next deadline was showing the
    // oldest dead one.
    //
    // `todayInIndia()` rather than a UTC date, so this and the SQL function
    // agree on the boundary instead of disagreeing for five and a half hours —
    // a closing date of the 10th means end of the 10th for someone in India.
    // `jobs_published_has_essentials` guarantees a published row has a
    // `last_date`, so this cannot silently drop a listing that simply has no
    // stated deadline.
    //
    // The date is captured when the cache entry renders, so the boundary can
    // lag by up to one `feed` revalidation. That bounds the error at hours
    // instead of "until someone notices ingestion stopped".
    .gte("last_date", todayInIndia())
    .order(column, { ascending, nullsFirst: false })
    .order("id", { ascending: true })
    .limit(limit + 1);

  if (cursor) {
    // The comparison follows the sort direction: resuming an ascending page
    // with `lt` would page backwards through rows already shown.
    const op = ascending ? "gt" : "lt";
    query = query.or(
      `${column}.${op}.${cursor.sortKey},` +
        `and(${column}.eq.${cursor.sortKey},id.${op}.${cursor.id})`,
    );
  }
  if (options.organizationSlug)
    query = query.eq("organizations.slug", options.organizationSlug);
  if (options.tag) query = query.contains("tags", [options.tag]);
  if (options.sector) query = query.contains("tags", [options.sector]);

  // `location_state`, not `state`. `state` is raw scraped text and is a
  // verbatim copy of `location` on every row — "New Delhi, Delhi", "Chennai,
  // Tamil Nadu", "Not Available" — so comparing it with `=` to a state name
  // matched almost nothing: the Tamil Nadu chip found 1 job where 20 named the
  // state. `location_state` is the generated, normalised answer; see migration
  // 0023.
  if (options.state && options.state !== "All India")
    query = query.eq("location_state", options.state);

  // Both are typed enums the ingest path already derives, so these filter on
  // real data rather than on `tags`, which is populated on 129 rows out of
  // 6,101 and left three of the six original chips returning nothing at all.
  if (options.level) query = query.eq("min_qualification_level", options.level);
  if (options.stream) query = query.eq("required_stream", options.stream);

  // Full-text search, against the generated `search_vector` and its GIN index.
  //
  // This was declared in JobListOptions and passed in by /jobs from the first
  // version of this file, and never applied — the search box filtered nothing
  // for anyone. The contract test covering it asserted only that the query was
  // bounded and named its columns, both of which were true of a query that
  // ignored the term entirely, so it passed throughout.
  //
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

  const rows = unwrap("listJobs", await query);

  return toPage(rows, limit, (row) => ({
    sortKey:
      sort === "closing"
        ? row.last_date
        : sort === "vacancy"
          ? String(row.vacancies ?? 0)
          : row.published_at,
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

  // The build-time sentinel is not a row and never will be, so it resolves to
  // null without a query. This is what makes the sentinel work: it is emitted
  // precisely when the database is unreachable, and querying for it would
  // throw for the same reason `generateStaticParams` just failed — turning the
  // fallback into the very build failure it exists to prevent.
  //
  // Deliberately a slug check and not a catch around the query: a real slug
  // hitting a real database error must still throw. Degrading that to null
  // would render a 404 and cache it, telling crawlers a live job page is gone.
  if (slug === BUILD_SENTINEL_SLUG) return null;

  return unwrapMaybe(
    "getJobBySlug",
    await detailQuery().eq("slug", slug).eq("status", "published").maybeSingle(),
  );
}

/**
 * What has changed on one listing.
 *
 * Rendered into the statically generated job page, so this read happens when
 * the job's tag is invalidated — not when someone visits. Tagged with the job
 * rather than the list: ingestion invalidates both, and the changes belong to
 * the page they appear on.
 *
 * Bounded at six. A listing that has been amended more times than that has a
 * history worth summarising rather than printing, and an unbounded read on a
 * page is the habit this codebase exists to break.
 */
export async function listJobChanges(jobId: string, limit = 6): Promise<JobChangeRow[]> {
  "use cache";
  cacheLife("content");
  cacheTag(tags.jobList());

  // Degrades rather than breaks, and the error is handled here rather than by
  // the caller because a promise that rejects inside a `"use cache"` scope
  // cannot be caught outside it — Next fails the build before the catch runs.
  //
  // This is a supplementary block on a page whose main job is the listing. A
  // missing changelog costs a reader some history; a throw costs them the page,
  // and at build time it costs every job page at once. That is not a
  // hypothetical: the first build after this table was created failed on all of
  // them, because PostgREST had not yet reloaded its schema cache and every
  // query returned "Could not find the table in the schema cache".
  const { data, error } = await publicDb()
    .from("job_changes")
    .select("id, field, old_value, new_value, changed_at")
    .eq("job_id", jobId)
    .order("changed_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.warn(`[listJobChanges] ${error.message}`);
    return [];
  }
  return data;
}

export interface JobChangeRow {
  id: number;
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
}

/**
 * Title and slug for one job, by id.
 *
 * For the "related notification" link on an update page. Two columns, because
 * that is what the link renders — pulling a full card to draw one line of text
 * is the habit this codebase's column lists exist to break.
 */
export async function getJobById(id: string): Promise<{
  slug: string;
  title: string;
  vacancies: number | null;
  vacancies_display: string | null;
  last_date: string | null;
  last_date_display: string | null;
} | null> {
  "use cache";
  cacheLife("content");
  cacheTag(tags.jobList());

  // Four columns beyond the link itself, because the update page's job card was
  // a bare title — and the two facts that decide whether someone clicks it are
  // how many posts there are and how long they have left. The old app's
  // equivalent banner carried both. This runs on a statically generated page
  // and only for the 194 updates that have a resolved `job_id`.
  return unwrapMaybe(
    "getJobById",
    await publicDb()
      .from("jobs")
      .select("slug, title, vacancies, vacancies_display, last_date, last_date_display")
      .eq("id", id)
      .eq("status", "published")
      .maybeSingle(),
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
 * Every published slug, for the sitemap.
 *
 * The one intentionally large read in this module: it runs on sitemap
 * revalidation, not per request. Two columns keep it to roughly 60 bytes a row
 * — about 350 kB across the whole corpus, a handful of times a day.
 *
 * That claim used to be false. The query said `.limit(20000)` and returned
 * exactly 1,000 rows, because Supabase caps responses at `max_rows`
 * server-side, after the query's own LIMIT, without erroring. The sitemap
 * advertised a fifth of the site and nothing reported it. `fetchAllRows` is
 * the fix and carries the full account.
 *
 * Ordered by `slug`, not `updated_at`. Offset paging re-reads the table per
 * request, so the sort key has to be unique or rows shuffle between pages and
 * get duplicated or dropped; `slug` is uniquely constrained and `updated_at`
 * is not. The sitemap does not care about order — every entry carries its own
 * `lastmod`.
 */
export async function listJobSlugs(): Promise<{ slug: string; updated_at: string }[]> {
  "use cache";
  cacheLife("feed");
  cacheTag(tags.jobList(), tags.sitemap());

  // Caught here rather than by the caller. The sitemap is generated at build
  // time, and a rejection escaping a `"use cache"` scope fails the build
  // outright — the caller's try/catch never runs. Degrading to an empty list
  // costs one cache window of a four-URL sitemap, which self-heals on the next
  // revalidation; the alternative costs the whole deploy.
  try {
    return await fetchAllRows("listJobSlugs", (from, to) =>
      publicDb()
        .from("jobs")
        .select("slug, updated_at")
        .eq("status", "published")
        .order("slug", { ascending: true })
        .range(from, to),
    );
  } catch (error) {
    console.warn(
      "[listJobSlugs] Unreachable; sitemap omits job pages this cache window.",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

/**
 * Titles of open vacancies, for the syllabus finder's typeahead.
 *
 * The old app suggested job titles by running `jobs ILIKE '%…%'` on every
 * keystroke. This is the same suggestion delivered the opposite way round: one
 * cached read per cache window, shared by every visitor, filtered in the
 * browser. The arithmetic was done before it was built — a per-keystroke fetch
 * would have cost roughly 1,260 invocations a month against a million-call
 * ceiling, so it was never a quota problem; it was a round trip per keystroke
 * for an answer that changes a few times a day.
 *
 * Two caps, and they are the whole cost control:
 *
 *   - `limit(800)` bounds what leaves Postgres. At ~100 bytes a row that is
 *     80 kB per cache window, roughly 2.4 MB a month on the `content` profile.
 *   - The caller dedupes to ~250 distinct exams before any of it reaches a
 *     browser. Job titles repeat heavily across years and regions — measured
 *     at 75% on the seeded corpus, 240 rows collapsing to 60 exams — so 800
 *     rows is already more than 250 distinct ones in practice.
 *
 * Only open vacancies. A closed one is not something to send somebody to from
 * a page about preparing for an exam, and excluding them is also what keeps
 * the row count bounded as the corpus grows.
 */
export async function listOpenJobTitles(): Promise<{ title: string; slug: string }[]> {
  "use cache";
  cacheLife("content");
  cacheTag(tags.jobList());

  // `today` rather than `now()`: `last_date` is a date, and a job closing today
  // is open today.
  const today = new Date().toISOString().slice(0, 10);

  try {
    return unwrap(
      "listOpenJobTitles",
      await publicDb()
        .from("jobs")
        .select("title, slug")
        .eq("status", "published")
        // An undated job is open until it says otherwise — the same reading
        // `JobActions` takes on the detail page.
        .or(`last_date.gte.${today},last_date.is.null`)
        .order("updated_at", { ascending: false })
        .limit(800),
    );
  } catch (error) {
    // Degrades to no vacancy suggestions rather than failing the render. The
    // syllabus typeahead's own exam suggestions are unaffected, so the box
    // still works — it is simply narrower for one cache window.
    console.warn(
      "[listOpenJobTitles] Unreachable; syllabus typeahead omits vacancies this cache window.",
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

/**
 * Slugs for `generateStaticParams`, uncached and failure-tolerant.
 *
 * Deliberately separate from `listJobSlugs`; the reasoning lives in
 * `src/lib/db/build-params.ts`, next to the sentinel it returns.
 *
 * ── Why this one is still capped ───────────────────────────────────────────
 * `listJobSlugs` above now pages to the whole corpus, because a sitemap that
 * omits four-fifths of the site is a discovery bug. This one does not, and the
 * difference is deliberate rather than an oversight left behind.
 *
 * Prerendering is a cost decision, not a discovery one. A slug that is not in
 * this list is still in the sitemap, still crawlable, and still cached for
 * thirty days after its first request — it costs one render, once. A slug that
 * *is* in this list costs a render on every deploy, and the job detail page
 * reads the `job_details` JSONB, so each one is ~15 kB of Supabase egress.
 * Across two routes that call this — `/jobs/[slug]` and `/countdown/[slug]` —
 * the whole corpus would be ~10,400 renders and ~150 MB per deploy, or about
 * 4.5 GB a month at thirty deploys, against a 5 GB free-tier ceiling. The cap
 * is what keeps a deploy from being the most expensive thing this app does.
 *
 * Ordered by `updated_at` descending, so the pages that are prerendered are
 * the ones most recently touched — which is what a crawler arriving on the
 * strength of a push notification will ask for first.
 *
 * Raising `BUILD_PRERENDER_LIMIT` is a legitimate thing to want; do the
 * arithmetic above with the current corpus size before you do, and re-run
 * `pnpm traffic`.
 */
export async function listJobSlugsForBuild(): Promise<{ slug: string }[]> {
  return slugsForBuild("listJobSlugsForBuild", async () => {
    const { data, error } = await publicDb()
      .from("jobs")
      .select("slug")
      .eq("status", "published")
      .order("updated_at", { ascending: false })
      .limit(BUILD_PRERENDER_LIMIT);

    if (error) throw error;
    return data;
  });
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

/**
 * The biggest recruitment drives currently open.
 *
 * A vacancy count is the one number that makes a listing worth a stranger's
 * attention before they know anything else about it, which is why the old home
 * page led with this row. Served by `jobs_vacancies_idx` — a partial index
 * ordered `vacancies desc nulls last`, so the planner walks it and stops at the
 * limit rather than sorting every published row to find six.
 */
export async function listHighestVacancy(limit: number = PAGE_SIZE.rail): Promise<JobCard[]> {
  "use cache";
  cacheLife("feed");
  cacheTag(tags.jobList());

  return unwrap(
    "listHighestVacancy",
    await cardQuery()
      .eq("status", "published")
      // "Currently open" is this row's whole claim — see the note in
      // `listJobs`. Without the date filter it is a claim the query does not
      // actually check, it just happens to be true whenever ingestion is
      // healthy.
      .gte("last_date", todayInIndia())
      .not("vacancies", "is", null)
      .order("vacancies", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false })
      .limit(limit),
  );
}
