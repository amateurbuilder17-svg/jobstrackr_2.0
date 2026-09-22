import "server-only";

import { cacheLife, cacheTag } from "next/cache";
import type { PostgrestError } from "@supabase/supabase-js";

import { BUILD_SENTINEL_SLUG } from "../build-params";
import { publicDb } from "../clients";
import { unwrap, unwrapMaybe } from "../errors";
import { API_MAX_ROWS, fetchAllRows } from "../paginate";
import { selectIn } from "../select-in";
import { tags } from "../tags";
import { todayInIndia } from "@/lib/format/deadline";
import { HUB_PAGE_SIZE, MIN_INDEXED_HUB_ITEMS, type HubFilter } from "@/lib/hubs/catalog";
import { UNINDEXED_UPDATE_CATEGORY, closedJobIndexCutoff } from "@/lib/seo/indexing";
import type { UpdateCategory } from "@/lib/updates/categories";

/**
 * Hub reads: one page of a hub's list, the organisation behind an organisation
 * hub, and the census the index pages are built from. The catalogue of hubs is
 * `lib/hubs/catalog.ts`.
 *
 * ── Cost ───────────────────────────────────────────────────────────────────
 * Every query here carries a `hub:` tag, which ingest never purges, and a
 * `hub` or `hubArchive` lifetime (two days, one week). That is the whole cost
 * story. A hub page re-renders at most once per window, and only if a request
 * arrives after it; if the list has not changed the rewrite costs no ISR write
 * units at all, which is most small hubs most weeks. Tagging these with
 * `jobs:list` would mark every hub page stale up to four times an hour — the
 * mechanism behind the 744K ISR writes of 949face.
 *
 * ── What a hub lists ───────────────────────────────────────────────────────
 * Exactly what the sitemap submits, through the same two rules: open jobs and
 * jobs closed within `CLOSED_JOB_INDEX_DAYS`, and every published update but
 * recruitment notices. A hub is a crawl path, and a crawl path into pages that
 * answer `noindex` spends the crawl on nothing.
 */

const JOB_ROW = `
  slug, title, published_at, last_date, status,
  organization:organizations ( name, short_name )
` as const;

const UPDATE_ROW = `
  slug, title, category, published_at, published_date,
  organization:organizations ( name, short_name )
` as const;

export interface HubItem {
  kind: "job" | "update";
  slug: string;
  title: string;
  /** The employer's short name, or its name. */
  organization: string | null;
  /** Ingest's publication timestamp; orders a merged list. */
  publishedAt: string | null;
  /** The date to print: the notice's own date for an update, else `publishedAt`. */
  date: string | null;
  /** A job's last date to apply. */
  lastDate: string | null;
  /** A job past its deadline, still inside the index window. */
  closed: boolean;
  /** An update's category. */
  category: UpdateCategory | null;
}

export interface HubPage {
  items: HubItem[];
  /** Everything the hub lists, across all its pages. */
  total: number;
}

/** Indexable jobs: open, or closed inside the index window. */
function jobsQuery(filter: HubFilter) {
  let query = publicDb()
    .from("jobs")
    .select(JOB_ROW, { count: "exact" })
    .in("status", ["published", "closed"])
    .or(`status.eq.published,last_date.gte.${closedJobIndexCutoff(todayInIndia())}`);

  if (filter.kind === "state") query = query.eq("location_state", filter.state);
  if (filter.kind === "sector") query = query.contains("tags", [filter.sector]);
  if (filter.kind === "level") query = query.eq("min_qualification_level", filter.level);
  if (filter.kind === "organisation")
    query = query.eq("organization_id", filter.organizationId);

  // `slug` breaks ties because it is unique, so a row cannot sit on two pages
  // or on none when several share a timestamp.
  return query
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("slug", { ascending: true });
}

/** Indexable updates: published, and not a recruitment notice. */
function updatesQuery(filter: HubFilter) {
  let query = publicDb()
    .from("exam_updates")
    .select(UPDATE_ROW, { count: "exact" })
    .eq("is_published", true)
    .neq("category", UNINDEXED_UPDATE_CATEGORY);

  if (filter.kind === "updateCategory") query = query.eq("category", filter.category);
  if (filter.kind === "organisation")
    query = query.eq("organization_id", filter.organizationId);

  return query
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("slug", { ascending: true });
}

type OrgEmbed = { name: string; short_name: string | null } | null;

/** The short name, or the name — a blank short name counts as none. */
function organisationName(org: OrgEmbed): string | null {
  const short = org?.short_name?.trim();
  if (short) return short;
  return org?.name.trim() ?? null;
}

function toJobItem(row: {
  slug: string;
  title: string;
  published_at: string | null;
  last_date: string | null;
  status: string;
  organization: OrgEmbed;
}): HubItem {
  return {
    kind: "job",
    slug: row.slug,
    title: row.title,
    organization: organisationName(row.organization),
    publishedAt: row.published_at,
    date: row.published_at,
    lastDate: row.last_date,
    closed: row.status === "closed",
    category: null,
  };
}

function toUpdateItem(row: {
  slug: string;
  title: string;
  category: UpdateCategory;
  published_at: string | null;
  published_date: string | null;
  organization: OrgEmbed;
}): HubItem {
  return {
    kind: "update",
    slug: row.slug,
    title: row.title,
    organization: organisationName(row.organization),
    publishedAt: row.published_at,
    date: row.published_date ?? row.published_at,
    lastDate: null,
    closed: false,
    category: row.category,
  };
}

/** Newest first, undated last, then by slug — the order both queries use. */
function byNewest(a: HubItem, b: HubItem): number {
  if (a.publishedAt !== b.publishedAt) {
    if (a.publishedAt === null) return 1;
    if (b.publishedAt === null) return -1;
    return a.publishedAt < b.publishedAt ? 1 : -1;
  }
  return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

/**
 * Whether PostgREST refused a range for starting past the last row.
 *
 * Asked for an exact count, it answers an offset beyond the end with 416 and
 * `PGRST103` rather than an empty page, and `unwrap` turns that into a 500.
 * The only way to ask for such a page is a URL past a hub's last page, which
 * nothing links to — but a guessed or stale one must be a 404, not a server
 * error in Search Console. Reported as empty with a total of nought, which
 * `loadHubPage` turns into exactly that 404.
 */
function pastTheEnd(result: { error: PostgrestError | null }): boolean {
  return result.error?.code === "PGRST103";
}

/**
 * One page of a hub's list, and how long the whole list is.
 *
 * `key` is the hub's catalogue key, used for the tag only; `filter` decides
 * what is read. Page 1 takes the `hub` lifetime and every later page the
 * longer `hubArchive` one — see the profiles in `next.config.ts`.
 */
export async function listHubPage(
  key: string,
  filter: HubFilter,
  page: number,
): Promise<HubPage> {
  "use cache";
  cacheLife(page === 1 ? "hub" : "hubArchive");
  cacheTag(tags.hub(key));

  const from = (page - 1) * HUB_PAGE_SIZE;
  const to = from + HUB_PAGE_SIZE - 1;

  if (filter.kind === "organisation") return organisationPage(filter, page);

  if (filter.kind === "updateCategory" || filter.kind === "allUpdates") {
    const result = await updatesQuery(filter).range(from, to);
    if (pastTheEnd(result)) return { items: [], total: 0 };
    const rows = unwrap("listHubPage:updates", result);
    return { items: rows.map(toUpdateItem), total: result.count ?? rows.length };
  }

  const result = await jobsQuery(filter).range(from, to);
  if (pastTheEnd(result)) return { items: [], total: 0 };
  const rows = unwrap("listHubPage:jobs", result);
  return { items: rows.map(toJobItem), total: result.count ?? rows.length };
}

/**
 * An organisation's jobs and updates, merged into one list, newest first.
 *
 * Two tables cannot share an offset, so page `n` reads the first `n × 50` rows
 * of each and merges them: the top `k` of a merged list is always inside the
 * top `k` of each part. That is exact up to Supabase's 1,000-row response cap,
 * which is where the reported total stops too, at twenty pages. No employer is
 * near it: on 22 Sep 2026 the whole indexable corpus was ~7,900 rows across
 * hundreds of employers.
 */
async function organisationPage(
  filter: Extract<HubFilter, { kind: "organisation" }>,
  page: number,
): Promise<HubPage> {
  const want = Math.min(page * HUB_PAGE_SIZE, API_MAX_ROWS);

  const [jobs, updates] = await Promise.all([
    jobsQuery(filter).range(0, want - 1),
    updatesQuery(filter).range(0, want - 1),
  ]);
  const jobRows = unwrap("listHubPage:organisation-jobs", jobs);
  const updateRows = unwrap("listHubPage:organisation-updates", updates);

  const merged = [...jobRows.map(toJobItem), ...updateRows.map(toUpdateItem)].sort(byNewest);
  const total = (jobs.count ?? jobRows.length) + (updates.count ?? updateRows.length);

  return {
    items: merged.slice((page - 1) * HUB_PAGE_SIZE, page * HUB_PAGE_SIZE),
    total: Math.min(total, API_MAX_ROWS),
  };
}

export interface HubOrganisation {
  id: string;
  slug: string;
  name: string;
  short_name: string | null;
}

/**
 * The organisation behind `/organisations/[slug]`, or null.
 *
 * Any organisation resolves, including one with nothing indexable today: a
 * detail page links to its employer's hub, and that link must not land on a
 * 404 the day the employer's last notice leaves the index window. An empty
 * hub renders, says so, and answers `noindex`.
 */
export async function getHubOrganisation(slug: string): Promise<HubOrganisation | null> {
  "use cache";
  cacheLife("hub");
  cacheTag(tags.hub(`org-${slug}`));

  // The sentinel and anything that cannot be a slug resolve without a query;
  // the format is the table's own check constraint.
  if (slug === BUILD_SENTINEL_SLUG || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return null;

  return unwrapMaybe(
    "getHubOrganisation",
    await publicDb()
      .from("organizations")
      .select("id, slug, name, short_name")
      .eq("slug", slug)
      .maybeSingle(),
  );
}

export interface HubCensus {
  jobs: number;
  updates: number;
  byState: Record<string, number>;
  bySector: Record<string, number>;
  byLevel: Record<string, number>;
  byUpdateCategory: Record<string, number>;
  /** Organisations with at least `MIN_INDEXED_HUB_ITEMS` items, by name. */
  organisations: (HubOrganisation & { count: number })[];
}

const EMPTY_CENSUS: HubCensus = {
  jobs: 0,
  updates: 0,
  byState: {},
  bySector: {},
  byLevel: {},
  byUpdateCategory: {},
  organisations: [],
};

/**
 * How many items the census counted for a state or category hub. Organisation
 * hubs are counted in `organisations`; the archives in `jobs` and `updates`.
 */
export function censusCount(census: HubCensus, filter: HubFilter): number {
  switch (filter.kind) {
    case "state":
      return census.byState[filter.state] ?? 0;
    case "sector":
      return census.bySector[filter.sector] ?? 0;
    case "level":
      return census.byLevel[filter.level] ?? 0;
    case "updateCategory":
      return census.byUpdateCategory[filter.category] ?? 0;
    case "allJobs":
      return census.jobs;
    case "allUpdates":
      return census.updates;
    case "organisation":
      return census.organisations.find((o) => o.id === filter.organizationId)?.count ?? 0;
  }
}

function bump(counts: Record<string, number>, key: string | null | undefined): void {
  if (key) counts[key] = (counts[key] ?? 0) + 1;
}

/**
 * How many indexable items every hub holds, for the index pages and the
 * sitemap.
 *
 * Counted here rather than with one `count` query per hub: that would be ~60
 * requests plus one per organisation, where this is about eight pages of four
 * narrow columns — roughly 1 MB, once per `hub` window. The same read as the
 * sitemap's, in shape and in size.
 *
 * Degrades to empty rather than throwing, for the reason `listJobSlugs` gives:
 * the index pages prerender at build, and a rejection inside a `"use cache"`
 * scope fails the build before any caller could catch it.
 */
export async function getHubCensus(): Promise<HubCensus> {
  "use cache";
  cacheLife("hub");
  cacheTag(tags.hub("census"));

  try {
    const cutoff = closedJobIndexCutoff(todayInIndia());
    const [jobs, updates] = await Promise.all([
      fetchAllRows("getHubCensus:jobs", (from, to) =>
        publicDb()
          .from("jobs")
          .select("organization_id, location_state, tags, min_qualification_level")
          .in("status", ["published", "closed"])
          .or(`status.eq.published,last_date.gte.${cutoff}`)
          .order("slug", { ascending: true })
          .range(from, to),
      ),
      fetchAllRows("getHubCensus:updates", (from, to) =>
        publicDb()
          .from("exam_updates")
          .select("organization_id, category")
          .eq("is_published", true)
          .neq("category", UNINDEXED_UPDATE_CATEGORY)
          .order("slug", { ascending: true })
          .range(from, to),
      ),
    ]);

    const census: HubCensus = {
      ...EMPTY_CENSUS,
      jobs: jobs.length,
      updates: updates.length,
      byState: {},
      bySector: {},
      byLevel: {},
      byUpdateCategory: {},
    };
    const byOrg: Record<string, number> = {};

    for (const row of jobs) {
      bump(census.byState, row.location_state);
      bump(census.byLevel, row.min_qualification_level);
      for (const tag of row.tags) bump(census.bySector, tag);
      bump(byOrg, row.organization_id);
    }
    for (const row of updates) {
      bump(census.byUpdateCategory, row.category);
      bump(byOrg, row.organization_id);
    }

    const listed = Object.keys(byOrg).filter((id) => (byOrg[id] ?? 0) >= MIN_INDEXED_HUB_ITEMS);
    const { data: orgs, error } = await selectIn(listed, (chunk) =>
      publicDb()
        .from("organizations")
        .select("id, slug, name, short_name")
        .in("id", chunk)
        .limit(chunk.length),
    );
    if (error) throw new Error(`getHubCensus:organizations: ${error.message}`);

    census.organisations = orgs
      .map((org) => ({ ...org, count: byOrg[org.id] ?? 0 }))
      .sort((a, b) => a.name.localeCompare(b.name, "en-IN"));

    return census;
  } catch (error) {
    console.warn(
      "[getHubCensus] Unreachable; hub indexes and their sitemap entries are empty this window.",
      error instanceof Error ? error.message : error,
    );
    return EMPTY_CENSUS;
  }
}
