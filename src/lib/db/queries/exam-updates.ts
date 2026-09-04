import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import type { QueryData } from "@supabase/supabase-js";

import { BUILD_PRERENDER_LIMIT, BUILD_SENTINEL_SLUG, slugsForBuild } from "../build-params";
import { publicDb } from "../clients";
import {
  type Cursor,
  decodeCursor,
  encodeCursor,
  toPage,
  type Page,
  PAGE_SIZE,
} from "../cursor";
import { unwrap, unwrapMaybe } from "../errors";
import { fetchAllRows } from "../paginate";
import { SEARCH_CONFIG, tags } from "../tags";
import type { Database } from "../database.types";
import { linkLabel } from "@/lib/updates/detail-shape";
import { toUrl } from "@/lib/sync/links";

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

/**
 * The category that waits at the back of the feed.
 *
 * A notification is the announcement that a recruitment exists, and it is both
 * the commonest thing in the table and the one nobody is refreshing the page
 * for: by the time it is published the applying window is weeks long. An admit
 * card, a result or an answer key is the opposite — it matters on the day. So
 * the feed shows everything else first and the notifications after it, unless
 * the reader has picked the Notifications chip, which is them saying that today
 * a notification is exactly what they came for.
 */
const TAIL_CATEGORY = "notification" satisfies UpdateCategory;

/**
 * "Resume at the first row of the tail", as a cursor key.
 *
 * A cursor names the last row already shown, and at this one boundary there is
 * no such row — the head ran out exactly on a page edge. A key beyond every
 * real `published_at`, in whichever direction the feed is sorted, makes the
 * keyset comparison admit the whole tail without a second code path for it.
 * `Z` rather than `+00:00`, so nothing downstream has to worry about a `+`
 * surviving URL encoding.
 */
const TAIL_START: Record<"asc" | "desc", string> = {
  asc: "0001-01-01T00:00:00Z",
  desc: "9999-12-31T23:59:59Z",
};

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export async function listExamUpdates(
  options: UpdateListOptions = {},
): Promise<Page<ExamUpdateCard>> {
  "use cache";
  cacheLife("feed");
  cacheTag(tags.examUpdateList());

  const limit = options.limit ?? PAGE_SIZE.list;
  const cursor = decodeCursor(options.cursor);
  const ascending = (options.sort ?? "newest") === "oldest";

  // A single character is treated as no filter rather than as a search that
  // matches nothing: it is almost always a keystroke on the way to a real
  // term, and emptying the page mid-typing reads as breakage.
  const term = options.query?.trim() ?? "";

  // Only an unfiltered-by-category feed has two halves to order. With a chip
  // on there is nothing to reorder: the chip is `notification`, and the feed is
  // all tail, or it is not, and there is no tail in it.
  const segmented = options.category === undefined;
  const inTail = segmented && cursor?.phase === 1;

  const build = (tail: boolean, from: Cursor | null, take: number) => {
    let query = cardQuery()
      .eq("is_published", true)
      .order("published_at", { ascending })
      .order("id", { ascending })
      .limit(take);

    if (segmented) {
      query = tail ? query.eq("category", TAIL_CATEGORY) : query.neq("category", TAIL_CATEGORY);
    } else if (options.category) {
      query = query.eq("category", options.category);
    }

    if (from) {
      // The comparison follows the sort direction: resuming a descending page
      // with `gt` would page backwards through rows already shown.
      const op = ascending ? "gt" : "lt";
      query = query.or(
        `published_at.${op}.${from.sortKey},` +
          `and(published_at.eq.${from.sortKey},id.${op}.${from.id})`,
      );
    }
    if (options.examSlug) query = query.eq("exams.slug", options.examSlug);
    if (term.length >= 2) {
      query = query.textSearch("search_vector", term, {
        config: SEARCH_CONFIG,
        type: "websearch",
      });
    }
    return query;
  };

  const rows = unwrap("listExamUpdates", await build(inTail, cursor, limit + 1));

  // One ordered run: either the feed has a category chip on it, or we are
  // already walking the tail. Both page exactly as this function always did.
  if (!segmented || inTail) {
    return toPage(rows, limit, (row) => ({
      sortKey: row.published_at,
      id: row.id,
      phase: inTail ? 1 : undefined,
    }));
  }

  if (rows.length > limit) {
    return toPage(rows, limit, (row) => ({ sortKey: row.published_at, id: row.id }));
  }

  // The head is spent. Everything below runs once per feed, at the seam.
  const tailCursor = () =>
    encodeCursor({ sortKey: TAIL_START[ascending ? "asc" : "desc"], id: NIL_UUID, phase: 1 });

  // Exactly on the edge — a full page of head rows and nothing left behind
  // them. Send the reader into the tail without spending a query to learn
  // whether it has anything in it.
  const need = limit - rows.length;
  if (need === 0) return { items: rows, nextCursor: tailCursor() };

  // A short head page, which is what a search or an `?exam=` filter usually
  // leaves. Top it up from the tail rather than handing back three rows and
  // making the reader's browser ask again for the other five.
  const tail = unwrap("listExamUpdates", await build(true, null, need + 1));
  const items = [...rows, ...tail.slice(0, need)];

  const boundary = tail[need - 1];
  if (tail.length <= need || !boundary?.published_at) return { items, nextCursor: null };

  return {
    items,
    nextCursor: encodeCursor({
      sortKey: boundary.published_at,
      id: boundary.id,
      phase: 1,
    }),
  };
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
      // Capped on purpose; see `listJobSlugsForBuild` for the arithmetic.
      .limit(BUILD_PRERENDER_LIMIT);

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
  //
  // Paged, and ordered by the unique `slug`, for the reason given there: this
  // query said `.limit(20000)` and was returning exactly 1,000 rows, because
  // Supabase's `max_rows` truncates server-side without erroring.
  try {
    return await fetchAllRows("listExamUpdateSlugs", (from, to) =>
      publicDb()
        .from("exam_updates")
        .select("slug, updated_at")
        .eq("is_published", true)
        .order("slug", { ascending: true })
        .range(from, to),
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
    const links = toDownloadLinks(row.detail?.download_links, row.category);
    return links.length === 0 ? [] : [{ title: row.title, category: row.category, links }];
  });
}

/**
 * Narrows the stored jsonb. Ingest writes `{label, url}`; anything older or
 * hand-edited is skipped rather than rendered as an empty row.
 *
 * This was the one surface that rendered a stored URL without putting it
 * through `toUrl` — it tested only for an `http` prefix, so a WhatsApp invite
 * or a `t.me` channel stored on an update would have appeared on the job page
 * of the job that update is attached to, under the heading "Documents". No such
 * row exists in production today (0 of 5,374 detail rows carry a blocked host),
 * which is exactly why the gap survived: nothing was there to reveal it until
 * the seed grew a row that had one.
 *
 * `linkLabel` for the same reason `/updates/[slug]` uses it — sources label
 * nearly every link "Click here", and the job page has no other text nearby to
 * tell one document from the next.
 */
function toDownloadLinks(
  value: unknown,
  category: UpdateCategory,
): { label: string; url: string }[] {
  if (!Array.isArray(value)) return [];

  const out: { label: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const url = toUrl(record.url ?? record.href);
    if (!url) continue;

    const key = url.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const raw = record.label ?? record.text ?? record.title;
    out.push({ label: linkLabel(typeof raw === "string" ? raw : "", url, category), url });
  }
  return out.slice(0, 8);
}

/**
 * Other updates about the same exam.
 *
 * The old app had three rails here — Results, Admit Cards, Similar Jobs — and
 * they were the page's main way out: someone reading an admit-card notice
 * usually wants that exam's exam-date notice next, and there is no other link
 * to it anywhere on the page.
 *
 * ── Why the search term rather than a foreign key ─────────────────────────
 * `exam_id` and `organization_id` are NULL on all 5,374 rows, so there is no
 * key to join on. The old rails did not use one either; they matched titles in
 * the browser over the newest 100 rows it had downloaded.
 *
 * This does the matching in Postgres against the existing GIN index, on the
 * organisation acronym the title leads with — see `relationTerm`. That is a
 * heuristic, and it is the right place for one: a wrong *navigation* link costs
 * a reader one back-press, which is why `job_link_state` refuses a guess for
 * the job link and this does not. Nothing here is presented as a fact about the
 * exam.
 */
export async function listRelatedUpdates(
  term: string,
  excludeSlug: string,
  limit = 6,
): Promise<ExamUpdateCard[]> {
  "use cache";
  cacheLife("content");
  cacheTag(tags.examUpdateList());

  return unwrap(
    "listRelatedUpdates",
    await cardQuery()
      .eq("is_published", true)
      .neq("slug", excludeSlug)
      .textSearch("search_vector", term, { config: SEARCH_CONFIG, type: "websearch" })
      .order("published_at", { ascending: false })
      .limit(limit),
  );
}

/* ── Tracker signals ───────────────────────────────────────────────────── */

/**
 * The categories that say something about where an exam has *got to*.
 *
 * `syllabus`, `cutoff` and `news` are deliberately absent: a syllabus post is
 * published months before anything happens, and a tracker that promoted an
 * exam to "Action Required" because someone wrote a news piece about it would
 * be crying wolf.
 */
const SIGNAL_CATEGORIES = [
  "admit_card",
  "result",
  "answer_key",
  "exam_date",
  "notification",
] as const satisfies readonly UpdateCategory[];

/**
 * One dated fact from the updates feed, as the tracker reads it.
 *
 * Deliberately three fields. The tracker does not render these — it uses them
 * to decide which of the three groups a tracked exam belongs in — so the title
 * is here only because a signal you cannot attribute to a source is one you
 * cannot check when it turns out to be wrong.
 */
export interface ExamUpdateSignal {
  category: UpdateCategory;
  title: string;
  slug: string;
  /** The date the commission published it, not the date we scraped it. */
  publishedDate: string | null;
}

/**
 * The recent signal updates for a tracker page's worth of attempts, keyed the
 * same way the AI status reports are — `exam:<id>` / `job:<id>`, per
 * `subjectKeyFor`.
 *
 * One query for the page rather than one per row, for the reason given on
 * `listStatusReports`. Public data, so it caches on the feed's clock: two
 * people tracking SSC CGL are asking the same question of the same rows.
 *
 * Returns an empty map rather than throwing when the read fails. These signals
 * only ever *upgrade* what the tracker knows — grouping falls back to the
 * attempt's own status and dates without them — so a degraded feed should cost
 * precision, not the page.
 */
export async function listUpdateSignals(
  examIds: string[],
  jobIds: string[],
): Promise<Map<string, ExamUpdateSignal[]>> {
  const exams = [...new Set(examIds)];
  const jobs = [...new Set(jobIds)];
  if (exams.length === 0 && jobs.length === 0) return new Map();

  const filters: string[] = [];
  if (exams.length > 0) filters.push(`exam_id.in.(${exams.join(",")})`);
  if (jobs.length > 0) filters.push(`job_id.in.(${jobs.join(",")})`);

  const { data, error } = await publicDb()
    .from("exam_updates")
    .select("slug, title, category, published_date, exam_id, job_id")
    .eq("is_published", true)
    .in("category", [...SIGNAL_CATEGORIES])
    .or(filters.join(","))
    // Newest first: every reader below takes the first match of a category.
    .order("published_date", { ascending: false, nullsFirst: false })
    .limit(PAGE_SIZE.attempts * 4);

  if (error) {
    console.warn(`[exam-updates] signal read failed: ${error.message}`);
    return new Map();
  }

  const bySubject = new Map<string, ExamUpdateSignal[]>();

  const push = (key: string, signal: ExamUpdateSignal) => {
    const existing = bySubject.get(key);
    if (existing) existing.push(signal);
    else bySubject.set(key, [signal]);
  };

  for (const row of data) {
    const signal: ExamUpdateSignal = {
      category: row.category,
      title: row.title,
      slug: row.slug,
      publishedDate: row.published_date,
    };
    // An update can carry both ids. It is then a fact about both subjects, and
    // an attempt keyed on either should see it.
    if (row.exam_id) push(`exam:${row.exam_id}`, signal);
    if (row.job_id) push(`job:${row.job_id}`, signal);
  }

  return bySubject;
}
