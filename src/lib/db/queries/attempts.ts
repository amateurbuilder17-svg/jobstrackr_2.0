import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { publicDb, sessionDb } from "../clients";
import { PAGE_SIZE } from "../cursor";
import { DbError, unwrap } from "../errors";
import { SEARCH_CONFIG, tags } from "../tags";
import type { Database } from "../database.types";

/**
 * Tracker reads.
 *
 * `listExamAttempts` is per-user and therefore uncached, for the same reason as
 * the saved list. `listExams` is public reference data — the same dozen rows for
 * everyone — so it caches like any other content read.
 */

type AttemptRow = Database["public"]["Tables"]["exam_attempts"]["Row"];

/**
 * The conducting body, as an attempt needs it: an emblem and a name to print.
 *
 * Named rather than inlined twice because an exam and a job reach the same
 * table by different joins, and the two shapes drifting apart is how one of
 * them quietly stops rendering a logo.
 */
interface OrganizationLabel {
  logo_path: string | null;
  short_name: string | null;
  name: string;
}

export type ExamAttempt = Pick<
  AttemptRow,
  | "id"
  | "exam_id"
  | "custom_name"
  | "stage"
  | "status"
  | "applied_at"
  | "exam_date"
  | "result_date"
  | "roll_number"
  | "score"
  | "notes"
  | "job_id"
> & {
  /** Null for an exam this app has never heard of, which is a supported case. */
  exam: {
    slug: string;
    name: string;
    short_name: string | null;
    /**
     * The conducting body's emblem, for the tile on the tracker card.
     *
     * It comes through the organisation rather than `exams.logo_path` because
     * that column has never been populated — the logo import resolves against
     * `organizations`, which is where the 164 images actually landed.
     *
     * The names ride along for the calendar, which labels a card "SSC ·
     * Tracked" and has nothing else to get the acronym from. Two short strings
     * on a join this query already performs — the row was always being read.
     */
    organization: OrganizationLabel | null;
  } | null;
  /**
   * Set when the attempt was started by pressing Track on a job page.
   *
   * `last_date` rides along because the tracker's grouping needs it: an
   * application closing on Friday is the difference between "Action Required"
   * and "Upcoming", and it is a fact about the notification, not about the
   * person, so nothing else on the row can supply it.
   */
  job: {
    slug: string;
    title: string;
    last_date: string | null;
    application_start_date: string | null;
    status: Database["public"]["Enums"]["job_status"];
    /** The other route to a logo: most attempts start as Track on a job. */
    organization: OrganizationLabel | null;
  } | null;
};

const ATTEMPT_COLUMNS = `
  id, exam_id, job_id, custom_name, stage, status,
  applied_at, exam_date, result_date, roll_number, score, notes,
  exam:exams ( slug, name, short_name, organization:organizations ( logo_path, short_name, name ) ),
  job:jobs ( slug, title, last_date, application_start_date, status, organization:organizations ( logo_path, short_name, name ) )
` as const;

export async function listExamAttempts(): Promise<ExamAttempt[]> {
  const db = await sessionDb();

  const rows: ExamAttempt[] = unwrap(
    "listExamAttempts",
    await db
      .from("exam_attempts")
      .select(ATTEMPT_COLUMNS)
      // Soonest exam first, undated last — someone opening this page wants to
      // know what is coming, not what they added most recently.
      .order("exam_date", { ascending: true, nullsFirst: false })
      .limit(PAGE_SIZE.attempts),
  );

  return rows;
}

/**
 * One attempt, with everything the status prompt needs to name its subject.
 *
 * A separate query from `listExamAttempts` rather than widening it: the
 * conducting body and the official website are two extra joins that the list
 * never renders, and this is fetched once per refresh rather than once per row.
 */
export interface AttemptSubject {
  id: string;
  exam_id: string | null;
  job_id: string | null;
  custom_name: string | null;
  stage: string | null;
  status: string;
  exam_date: string | null;
  result_date: string | null;
  exam: {
    name: string;
    official_website: string | null;
    organization: { name: string } | null;
  } | null;
  job: {
    title: string;
    source_url: string | null;
    organization: { name: string } | null;
  } | null;
}

const SUBJECT_COLUMNS =
  "id, exam_id, job_id, custom_name, stage, status, exam_date, result_date, " +
  "exam:exams ( name, official_website, organization:organizations ( name ) ), " +
  "job:jobs ( title, source_url, organization:organizations ( name ) )";

/**
 * Returns null for an id that is not this user's, rather than throwing.
 *
 * RLS is what enforces that — the filter below is belt to its braces — and a
 * forged id therefore reads as "no such attempt", which is both true from the
 * caller's perspective and the answer that leaks least.
 */
export async function getAttemptSubject(id: string): Promise<AttemptSubject | null> {
  const db = await sessionDb();

  const { data, error } = await db
    .from("exam_attempts")
    .select(SUBJECT_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw new DbError("getAttemptSubject", error);
  return data as AttemptSubject | null;
}

export interface ExamOption {
  id: string;
  name: string;
  short_name: string | null;
}

/** The exam picker's options. Public reference data, so it caches. */
export async function listExams(): Promise<ExamOption[]> {
  "use cache";
  cacheLife("content");
  cacheTag(tags.examList());

  return unwrap(
    "listExams",
    await publicDb()
      .from("exams")
      .select("id, name, short_name")
      .eq("is_active", true)
      .order("name", { ascending: true })
      .limit(PAGE_SIZE.admin),
  );
}

/**
 * Which jobs the current user tracks, as ids.
 *
 * The sibling of `listSavedJobIds`, and it rides on the same request: the
 * job page and every job card need one bit per job, and a second round trip
 * to learn a second bit would double the per-session cost of keeping the
 * static pages static. See `/api/session`.
 */
export async function listTrackedJobIds(): Promise<string[]> {
  const db = await sessionDb();

  const rows = unwrap(
    "listTrackedJobIds",
    await db
      .from("exam_attempts")
      .select("job_id")
      .not("job_id", "is", null)
      .limit(PAGE_SIZE.savedIds),
  );

  // `job_id` is non-null by the filter above, and the generated type agrees.
  return rows.map((row) => row.job_id);
}

/* ── Subject suggestions for the tracker's add form ─────────────────────── */

/**
 * What the add-exam typeahead offers.
 *
 * A published job, not an `exams` row. `exams` holds 0 rows in production and
 * `jobs` holds 2,593 published ones, so the picker that read the former was
 * permanently empty — and a job is the truer subject anyway: it carries its own
 * deadline, its own dates and its own AI status report, which is exactly the
 * information the form used to ask the user to type in by hand.
 */
export interface SubjectSuggestion {
  jobId: string;
  title: string;
  /** Acronym where the org has one — "SSC", not "Staff Selection Commission". */
  organization: string | null;
  /** Shown next to the title so two cycles of one exam are told apart. */
  lastDate: string | null;
}

/**
 * Below this the request is refused without touching Postgres.
 *
 * Three characters is where an Indian exam name starts to mean something —
 * "ssc", "rrb", "upsc" — and it is the difference between one query per search
 * and one per keystroke.
 */
export const SUGGEST_MIN_CHARS = 3;

/** What the user sees. */
export const SUGGEST_LIMIT = 6;

/**
 * What Postgres returns before ranking. Four times the visible list, because
 * the index orders by deadline and relevance is decided here — see `score`.
 * Twenty-four narrow rows measure ~6 kB on the wire, which is the whole
 * per-search egress cost.
 */
const SUGGEST_CANDIDATES = 24;

/**
 * Folds a raw input into the cache key and the tsquery.
 *
 * Exported because the route handler normalises before deciding whether the
 * term is long enough, and the client caches on the same string. Three
 * different notions of "the same search" would mean three times the queries.
 */
export function normalizeSuggestTerm(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}

/**
 * Every token AND-ed, with the last one left open as a prefix.
 *
 * `to_tsquery` rather than `websearch_to_tsquery`, which is what every other
 * search in this file uses: websearch has no prefix operator, so "upsc civ"
 * would match nothing until the final "il" was typed. The input is already
 * reduced to `[a-z0-9 ]` above, so nothing here can inject tsquery syntax.
 */
function toPrefixQuery(term: string): string | null {
  const tokens = term.split(" ").filter(Boolean);
  if (tokens.length === 0) return null;
  return tokens.map((t, i) => (i === tokens.length - 1 ? `${t}:*` : t)).join(" & ");
}

/**
 * Relevance, decided here rather than in SQL.
 *
 * PostgREST cannot order by `ts_rank`, and the alternative is a `security
 * definer` RPC — a migration, for an ordering rule that will be tuned. So the
 * index answers "which rows contain these lexemes" and this answers "which of
 * them is the user typing". Without it, "ssc" led with NPCIL Kudankulam:
 * `last_date desc` over an unranked match set is arbitrary.
 */
function score(
  row: { title: string; organization: string | null },
  tokens: string[],
  term: string,
) {
  const title = row.title.toLowerCase();
  const org = row.organization?.toLowerCase() ?? "";

  // The whole typed string appearing intact beats any accumulation of parts.
  let total = title.includes(term) ? 6 : 0;

  for (const token of tokens) {
    const atWordStart = new RegExp(`\\b${token}`);
    if (atWordStart.test(title)) total += 3;
    else if (title.includes(token)) total += 1;
    if (atWordStart.test(org)) total += 1;
  }
  return total;
}

/**
 * Suggestions for a partially typed exam name.
 *
 * ── Why this is cheap ──────────────────────────────────────────────────────
 * One GIN-indexed query per *search*, not per keystroke, and never one for a
 * term under three characters. `"use cache"` keys on the normalised term, so
 * the hundred people who type "ssc" this hour share one read; the route handler
 * in front of it carries a CDN `s-maxage`, so most of them never reach a
 * function invocation either. Four narrow columns, bounded at 24 rows.
 *
 * Tagged `jobList()`, so a sync run that publishes a new notification makes it
 * suggestible without waiting out the profile's timer.
 */
export async function suggestSubjects(rawTerm: string): Promise<SubjectSuggestion[]> {
  "use cache";
  cacheLife("feed");
  cacheTag(tags.jobList());

  const term = normalizeSuggestTerm(rawTerm);
  if (term.length < SUGGEST_MIN_CHARS) return [];

  const tsquery = toPrefixQuery(term);
  if (!tsquery) return [];

  const rows = unwrap(
    "suggestSubjects",
    await publicDb()
      .from("jobs")
      .select("id, title, last_date, organization:organizations ( short_name, name )")
      .eq("status", "published")
      .textSearch("search_vector", tsquery, { config: SEARCH_CONFIG })
      // Newest cycle first among equally relevant matches, which is what makes
      // the 2026 notification sit above the 2025 one.
      .order("last_date", { ascending: false, nullsFirst: false })
      .limit(SUGGEST_CANDIDATES),
  );

  const tokens = term.split(" ").filter(Boolean);

  const candidates = rows.map((row) => ({
    jobId: row.id,
    title: row.title,
    organization: row.organization?.short_name ?? row.organization?.name ?? null,
    lastDate: row.last_date,
  }));

  // Two sources describing one posting under two organisations survive
  // `merge_duplicate_jobs`, which only collapses within an organisation — so
  // "RRB ALP (CEN 01/2026)" really does appear twice in the table. Offering it
  // twice makes the picker look broken.
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    const key = c.title.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique
    .map((row) => ({ row, rank: score(row, tokens, term) }))
    .sort(
      (a, b) => b.rank - a.rank || (b.row.lastDate ?? "").localeCompare(a.row.lastDate ?? ""),
    )
    .slice(0, SUGGEST_LIMIT)
    .map(({ row }) => row);
}
