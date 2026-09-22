import type { Database } from "@/lib/db/database.types";
import { UNINDEXED_UPDATE_CATEGORY } from "@/lib/seo/indexing";
import { UPDATE_CATEGORIES, type UpdateCategory } from "@/lib/updates/categories";
import { INDIAN_STATES, SECTORS } from "@/lib/vocab";

/**
 * Hub pages: the crawl path into the detail pages.
 *
 * On 22 Sep 2026 the whole site linked to about 110 of its ~7,900 indexable
 * detail pages. Home linked 12 jobs, /jobs 20, /updates 20, /countdown 60, and
 * nothing paginated: the lists load more through client JavaScript, and
 * `robots.txt` disallows their query-string forms. Everything else was
 * reachable only through the sitemap, which is the weakest discovery signal
 * Google has, and most of it sat in "Discovered – currently not indexed".
 *
 * A hub is a plain, server-rendered, paginated list of links: every
 * indexable job in one state, every result, every notice from one employer.
 * Between them the hubs and the two archives (`/jobs/page/n`,
 * `/updates/page/n`) reach every indexable detail page within three clicks of
 * any page on the site, through the footer.
 *
 * This file is the catalogue: which hubs exist, what they are called and where
 * they live. It has no server imports, so it is unit-testable and the footer
 * can read it. The queries are in `lib/db/queries/hubs.ts`.
 */

/** Rows per hub page. Fifty keeps a page well under the weight of a detail page. */
export const HUB_PAGE_SIZE = 50;

/**
 * Below this many items a hub is a thin page, and says `noindex`. It still
 * renders, and still links onward, because detail pages link to their hubs and
 * a link should never land on a 404.
 */
export const MIN_INDEXED_HUB_ITEMS = 3;

type QualificationLevel = Database["public"]["Enums"]["qualification_level"];

/** What a hub lists. Serialisable, because it keys a `"use cache"` entry. */
export type HubFilter =
  | { kind: "state"; state: string }
  | { kind: "sector"; sector: string }
  | { kind: "level"; level: QualificationLevel }
  | { kind: "updateCategory"; category: UpdateCategory }
  | { kind: "organisation"; organizationId: string }
  | { kind: "allJobs" }
  | { kind: "allUpdates" };

export interface Hub {
  /** Stable identifier; keys the cache tag. */
  key: string;
  /** Page 1's path. */
  path: string;
  /** The archives number their first page too (`/jobs/page/1`); hubs do not. */
  numberedFirstPage?: boolean;
  /** The `<h1>` and the page title. */
  heading: string;
  /** The short name used in index lists and breadcrumbs. */
  label: string;
  /** The meta description and the sentence under the heading. */
  description: string;
  filter: HubFilter;
  /** The index page this hub is listed on. */
  parent: { name: string; path: string };
}

/* ── Slugs and paths ──────────────────────────────────────────────────────── */

/** "Andaman and Nicobar Islands" → "andaman-and-nicobar-islands". */
export function toHubSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The path of page `n` of a hub. */
export function hubPagePath(hub: Pick<Hub, "path" | "numberedFirstPage">, n: number): string {
  return n === 1 && !hub.numberedFirstPage ? hub.path : `${hub.path}/page/${String(n)}`;
}

/** How many pages `total` items fill. An empty hub still has its first page. */
export function hubPageCount(total: number): number {
  return Math.max(1, Math.ceil(total / HUB_PAGE_SIZE));
}

/**
 * A `/page/[n]` segment as a page number, or null.
 *
 * Strict on purpose: `02`, `2.0` and `+2` would each be a second URL for page
 * 2, and duplicate URLs are what this whole file exists to stop producing.
 * `min` is 2 for hubs, whose page 1 is the bare path, and 1 for the archives.
 */
export function parsePageNumber(raw: string, min: number): number | null {
  if (!/^[1-9][0-9]{0,3}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min ? n : null;
}

/**
 * The page numbers a pager shows: the first, the last, and two either side of
 * the current one, with `null` where a run is elided. Every page stays within
 * a few hops of every other, which is what a crawler walking the links needs.
 */
export function pagerWindow(current: number, last: number): (number | null)[] {
  const shown = new Set([1, last]);
  for (let n = current - 2; n <= current + 2; n++) if (n >= 1 && n <= last) shown.add(n);

  const out: (number | null)[] = [];
  let previous = 0;
  for (const n of [...shown].sort((a, b) => a - b)) {
    if (n - previous > 1) out.push(null);
    out.push(n);
    previous = n;
  }
  return out;
}

/* ── States ───────────────────────────────────────────────────────────────── */

const STATES_INDEX = { name: "States", path: "/states" };

/**
 * One hub per state and union territory, plus "All India", which is a stored
 * value of `location_state` and not an absence: on 26 Aug 2026 it covered 39%
 * of listings, the central recruitments open to anyone in the country.
 */
export const STATE_HUBS: readonly Hub[] = INDIAN_STATES.map((state) => {
  const allIndia = state === "All India";
  return {
    key: `state-${toHubSlug(state)}`,
    path: `/states/${toHubSlug(state)}`,
    heading: allIndia ? "All-India government jobs" : `Government jobs in ${state}`,
    label: state,
    description: allIndia
      ? "Central and all-India government job notifications open to candidates from every state, with last dates."
      : `Government job notifications in ${state}: open vacancies and recently closed ones, with last dates.`,
    filter: { kind: "state", state },
    parent: STATES_INDEX,
  };
});

/* ── Categories ───────────────────────────────────────────────────────────── */

const CATEGORIES_INDEX = { name: "Categories", path: "/categories" };

/** Written out rather than derived from `SECTORS` labels, which read as chips ("Railways"). */
const SECTOR_HEADINGS: Record<(typeof SECTORS)[number]["value"], string> = {
  banking: "Banking and insurance jobs",
  railway: "Railway jobs",
  defence: "Defence and paramilitary jobs",
  teaching: "Teaching jobs",
  engineering: "Engineering and technical jobs",
  medical: "Medical and health jobs",
  police: "Police jobs",
  clerical: "Clerical and administrative jobs",
  "central-govt": "Central government jobs",
  "state-govt": "State government jobs",
  psu: "PSU jobs",
  judiciary: "Judiciary and legal jobs",
};

const LEVELS: {
  level: QualificationLevel;
  slug: string;
  heading: string;
  label: string;
  /** Completes "the minimum qualification is …". */
  phrase: string;
}[] = [
  {
    level: "class_10",
    slug: "10th-pass",
    heading: "10th pass government jobs",
    label: "10th pass",
    phrase: "class 10",
  },
  {
    level: "class_12",
    slug: "12th-pass",
    heading: "12th pass government jobs",
    label: "12th pass",
    phrase: "class 12",
  },
  {
    level: "iti",
    slug: "iti",
    heading: "ITI government jobs",
    label: "ITI",
    phrase: "an ITI certificate",
  },
  {
    level: "diploma",
    slug: "diploma",
    heading: "Diploma government jobs",
    label: "Diploma",
    phrase: "a diploma",
  },
  {
    level: "bachelor",
    slug: "graduate",
    heading: "Graduate government jobs",
    label: "Graduate",
    phrase: "a bachelor's degree",
  },
  {
    level: "master",
    slug: "postgraduate",
    heading: "Postgraduate government jobs",
    label: "Postgraduate",
    phrase: "a master's degree",
  },
  {
    level: "doctorate",
    slug: "phd",
    heading: "PhD and doctorate jobs",
    label: "PhD",
    phrase: "a doctorate",
  },
];

/** Every update category that is indexed, which is all but recruitment notices. */
const UPDATE_HUB_COPY: Record<
  Exclude<UpdateCategory, typeof UNINDEXED_UPDATE_CATEGORY>,
  { slug: string; heading: string; label: string; description: string }
> = {
  result: {
    slug: "results",
    heading: "Government exam results",
    label: "Results",
    description: "The latest government exam results, merit lists and scorecards.",
  },
  admit_card: {
    slug: "admit-cards",
    heading: "Admit cards",
    label: "Admit cards",
    description: "Admit cards and hall tickets for government exams, newest first.",
  },
  answer_key: {
    slug: "answer-keys",
    heading: "Answer keys",
    label: "Answer keys",
    description: "Provisional and final answer keys for government exams, newest first.",
  },
  syllabus: {
    slug: "syllabus",
    heading: "Syllabus and exam pattern",
    label: "Syllabus",
    description: "Syllabus and exam pattern notices for government exams, newest first.",
  },
  exam_date: {
    slug: "exam-dates",
    heading: "Exam dates",
    label: "Exam dates",
    description: "Exam date and schedule notices for government exams, newest first.",
  },
  cutoff: {
    slug: "cut-offs",
    heading: "Cut-off marks",
    label: "Cut-offs",
    description: "Cut-off marks for government exams, newest first.",
  },
  news: {
    slug: "news",
    heading: "Government exam news",
    label: "News",
    description: "News and notices about government exams and recruitments.",
  },
};

export type CategoryGroup = "sector" | "level" | "update";

export interface CategoryHub extends Hub {
  group: CategoryGroup;
}

export const CATEGORY_HUBS: readonly CategoryHub[] = [
  ...SECTORS.map((s): CategoryHub => ({
    key: `sector-${s.value}`,
    path: `/categories/${s.value}`,
    heading: SECTOR_HEADINGS[s.value],
    label: s.label,
    description: `${SECTOR_HEADINGS[s.value]}: open government vacancies and recently closed ones, with last dates.`,
    filter: { kind: "sector", sector: s.value },
    parent: CATEGORIES_INDEX,
    group: "sector",
  })),
  ...LEVELS.map((l): CategoryHub => ({
    key: `level-${l.slug}`,
    path: `/categories/${l.slug}`,
    heading: l.heading,
    label: l.label,
    description: `Government vacancies where the minimum qualification is ${l.phrase}: open ones and recently closed ones, with last dates.`,
    filter: { kind: "level", level: l.level },
    parent: CATEGORIES_INDEX,
    group: "level",
  })),
  ...UPDATE_CATEGORIES.filter(
    (c): c is keyof typeof UPDATE_HUB_COPY => c !== UNINDEXED_UPDATE_CATEGORY,
  ).map((c): CategoryHub => {
    const copy = UPDATE_HUB_COPY[c];
    return {
      key: `update-${copy.slug}`,
      path: `/categories/${copy.slug}`,
      heading: copy.heading,
      label: copy.label,
      description: copy.description,
      filter: { kind: "updateCategory", category: c },
      parent: CATEGORIES_INDEX,
      group: "update",
    };
  }),
];

export const CATEGORY_GROUP_LABELS: Record<CategoryGroup, string> = {
  sector: "Jobs by sector",
  level: "Jobs by qualification",
  update: "Exam updates",
};

/* ── Organisations ────────────────────────────────────────────────────────── */

const ORGANISATIONS_INDEX = { name: "Organisations", path: "/organisations" };

/** A hub for one conducting body, built from its row. */
export function organisationHub(org: {
  id: string;
  slug: string;
  name: string;
  short_name: string | null;
}): Hub {
  const short = org.short_name?.trim();
  const label =
    short && short.toLowerCase() !== org.name.trim().toLowerCase() ? short : org.name;
  return {
    key: `org-${org.slug}`,
    path: `/organisations/${org.slug}`,
    heading: `${org.name} jobs and exam updates`,
    label,
    description: `Every current ${label} recruitment notification, result, admit card and answer key, with dates.`,
    filter: { kind: "organisation", organizationId: org.id },
    parent: ORGANISATIONS_INDEX,
  };
}

/* ── Archives ─────────────────────────────────────────────────────────────── */

/** Every indexable job, newest first: the one list guaranteed to reach them all. */
export const ALL_JOBS_HUB: Hub = {
  key: "all-jobs",
  path: "/jobs",
  numberedFirstPage: true,
  heading: "All government jobs",
  label: "All jobs",
  description:
    "Every government job notification on JobsTrackr, open and recently closed, newest first.",
  filter: { kind: "allJobs" },
  parent: { name: "Jobs", path: "/jobs" },
};

/** Every indexable update, newest first. */
export const ALL_UPDATES_HUB: Hub = {
  key: "all-updates",
  path: "/updates",
  numberedFirstPage: true,
  heading: "All exam updates",
  label: "All updates",
  description:
    "Every exam result, admit card, answer key and notice on JobsTrackr, newest first.",
  filter: { kind: "allUpdates" },
  parent: { name: "Updates", path: "/updates" },
};

/* ── Lookups ──────────────────────────────────────────────────────────────── */

const BY_STATE_SLUG = new Map(STATE_HUBS.map((h) => [h.path.slice("/states/".length), h]));
const BY_CATEGORY_SLUG = new Map(
  CATEGORY_HUBS.map((h) => [h.path.slice("/categories/".length), h]),
);

export function stateHub(slug: string): Hub | undefined {
  return BY_STATE_SLUG.get(slug);
}

export function categoryHub(slug: string): CategoryHub | undefined {
  return BY_CATEGORY_SLUG.get(slug);
}

/** The hub for a sector tag on a job, if the tag is one the catalogue knows. */
export function sectorHubPath(tag: string): string | undefined {
  return CATEGORY_HUBS.find((h) => h.filter.kind === "sector" && h.filter.sector === tag)?.path;
}

/** The hub for an update's category; recruitment notices have none. */
export function updateCategoryHubPath(category: UpdateCategory): string | undefined {
  return CATEGORY_HUBS.find(
    (h) => h.filter.kind === "updateCategory" && h.filter.category === category,
  )?.path;
}

/** The links every page carries in its footer. */
export const BROWSE_LINKS = [
  { href: ORGANISATIONS_INDEX.path, label: "Organisations" },
  { href: STATES_INDEX.path, label: "States" },
  { href: CATEGORIES_INDEX.path, label: "Categories" },
  { href: hubPagePath(ALL_JOBS_HUB, 1), label: "All jobs" },
  { href: hubPagePath(ALL_UPDATES_HUB, 1), label: "All updates" },
] as const;
