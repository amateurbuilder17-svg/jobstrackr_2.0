import "server-only";

import { adminOnly, type AdminPage } from "./admin";
import { unwrap } from "../errors";

/**
 * The operational pages: logos, ingestion sources, and the AI key pool.
 *
 * All three existed in the old admin and all three worked by reading a whole
 * table into the browser. The logo tab pulled every job so it could list the
 * departments with no logo; here the relationship is a foreign key and the
 * question is a `where logo_path is null`.
 */

/* ── Logos ─────────────────────────────────────────────────────────────── */

export interface LogoCoverage {
  totalOrgs: number;
  withLogo: number;
  /** Published listings whose organisation has a logo. */
  jobsWithLogo: number;
  jobsTotal: number;
}

export async function getLogoCoverage(): Promise<LogoCoverage> {
  const db = await adminOnly("getLogoCoverage");
  const rows = unwrap("getLogoCoverage", await db.rpc("admin_logo_coverage"));
  const row = rows[0];

  return {
    totalOrgs: row?.total_orgs ?? 0,
    withLogo: row?.with_logo ?? 0,
    jobsWithLogo: row?.jobs_with_logo ?? 0,
    jobsTotal: row?.jobs_total ?? 0,
  };
}

export interface AdminOrgRow {
  id: string;
  slug: string;
  name: string;
  shortName: string | null;
  logoPath: string | null;
  /** Published listings. The reason to care about this row before that one. */
  jobCount: number;
}

const ORG_PAGE = 50;

/**
 * Organisations, ordered by how much a missing logo costs.
 *
 * A body with 400 listings and no logo is 400 pages rendering initials; a body
 * with one is not worth an afternoon. The RPC sorts by job count for exactly
 * that reason, so the top of page one is always the work worth doing.
 */
export async function listOrganizations(options: {
  page?: number;
  query?: string | undefined;
  /** Default: only the ones still missing a logo. */
  missingOnly?: boolean;
}): Promise<AdminPage<AdminOrgRow>> {
  const db = await adminOnly("listOrganizations");
  const page = clampPage(options.page);
  const query = options.query?.trim();

  const rows = unwrap(
    "listOrganizations",
    // Spread rather than an explicit `undefined`: PostgREST serialises the key
    // either way, so passing it undefined sends `"p_query": null` instead of
    // omitting it and letting the function's own default apply.
    await db.rpc("admin_list_organizations", {
      p_limit: ORG_PAGE,
      p_offset: (page - 1) * ORG_PAGE,
      p_missing: options.missingOnly ?? true,
      ...(query ? { p_query: query } : {}),
    }),
  );

  const total = rows[0]?.total ?? 0;

  return {
    rows: rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      shortName: row.short_name,
      logoPath: row.logo_path,
      jobCount: row.job_count,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / ORG_PAGE)),
  };
}

/* ── Ingestion sources ─────────────────────────────────────────────────── */

export interface SourceHealth {
  id: string;
  name: string;
  url: string;
  host: string;
  category: string;
  isActive: boolean;
  limitPerRun: number;
  lastScrapedAt: string | null;
  /** Updates ever attributed to this host. */
  rowsTotal: number;
  rowsLast7Days: number;
  lastRowAt: string | null;
}

/**
 * What each configured source has actually been landing.
 *
 * Attribution is by host against `exam_updates.source_url` — a relationship the
 * rows genuinely carry — rather than by joining `sync_runs`, whose `kind` is
 * the feed and not the source. Joining on that would give every source in a
 * feed identical numbers and present them as per-source figures.
 */
export async function getSourceHealth(): Promise<SourceHealth[]> {
  const db = await adminOnly("getSourceHealth");
  const rows = unwrap("getSourceHealth", await db.rpc("admin_source_health"));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    url: row.url,
    host: row.host,
    category: row.category,
    isActive: row.is_active,
    limitPerRun: row.limit_per_run,
    lastScrapedAt: row.last_scraped_at,
    rowsTotal: row.rows_total,
    rowsLast7Days: row.rows_7d,
    lastRowAt: row.last_row_at,
  }));
}

export interface SyncDay {
  day: string;
  kind: string;
  runs: number;
  failures: number;
  seen: number;
  inserted: number;
  updated: number;
  unchanged: number;
}

/**
 * Ingestion, by day. The old "Fetched by Date" table, which the browser used to
 * build by reducing every sync-log row it had downloaded.
 *
 * `unchanged` is the column to read. A healthy re-run over a feed that has not
 * moved should be almost entirely unchanged rows — that is the diff working,
 * and it is what keeps a fifteen-minute ingest schedule inside the free tier.
 */
export async function getSyncByDay(days = 14): Promise<SyncDay[]> {
  const db = await adminOnly("getSyncByDay");
  return unwrap("getSyncByDay", await db.rpc("admin_sync_by_day", { p_days: days }));
}

/* ── The AI key pool ───────────────────────────────────────────────────── */

export interface ApiKeyRow {
  id: string;
  provider: string;
  model: string;
  label: string | null;
  /** First six characters and nothing more. See below. */
  hint: string;
  isActive: boolean;
  priority: number;
  totalCalls: number;
  totalErrors: number;
  lastUsedAt: string | null;
  lastError: string | null;
}

/**
 * The rotation pool, as a status board.
 *
 * The key material never leaves the server. The old admin page selected the
 * decrypted key into the browser and offered an eye icon and a copy button —
 * so ten production API keys sat in the DOM of a page whose only protection was
 * a role check, recoverable from any browser extension with page access.
 *
 * What an operator actually needs from this table is which key is carrying the
 * load and which one has quietly stopped working, and neither question needs
 * the secret. A six-character prefix is enough to tell two rows apart when
 * matching them against the provider's console; the rest never crosses the
 * network. To *use* a key, add it — to read one, look in the provider's
 * dashboard.
 */
export async function listApiKeys(): Promise<ApiKeyRow[]> {
  const db = await adminOnly("listApiKeys");

  const rows = unwrap(
    "listApiKeys",
    await db
      .from("decrypted_api_keys_config")
      // One literal, not a concatenation: the client parses this string as a
      // type to shape the row, and `a + b` is `string` rather than a literal —
      // which silently degrades every field below to `unknown`.
      .select(
        "id, provider, model_name, label, api_key, is_active, priority, total_calls, total_errors, last_used_at, last_error",
      )
      .order("priority", { ascending: true }),
  );

  return rows.flatMap((row) => {
    // Every column of this view arrives nullable — PostgREST cannot see the
    // `not null` through it — so a row missing its identity is skipped rather
    // than asserted away. `api_key` is the one that genuinely can be null, when
    // `decrypt_api_key` refuses.
    if (row.id === null) return [];

    return [
      {
        id: row.id,
        provider: row.provider ?? "unknown",
        model: row.model_name ?? "unknown",
        label: row.label,
        hint: row.api_key === null ? "unreadable" : `${row.api_key.slice(0, 6)}…`,
        isActive: row.is_active ?? false,
        priority: row.priority ?? 0,
        totalCalls: row.total_calls ?? 0,
        totalErrors: row.total_errors ?? 0,
        lastUsedAt: row.last_used_at,
        lastError: row.last_error,
      },
    ];
  });
}

function clampPage(page: number | undefined): number {
  if (!page || !Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.trunc(page), 10_000);
}
