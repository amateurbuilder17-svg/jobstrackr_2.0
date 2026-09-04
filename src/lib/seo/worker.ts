import "server-only";

import { adminDb, type Db } from "@/lib/db/clients";
import { env, getServerEnv } from "@/lib/env";

import { highestUpdatedAt, mergeByUpdatedAt, trimToCompleteBatch } from "./candidates";
import { submitToGoogle } from "./google-indexing";
import { submitToIndexNow } from "./indexnow";
import { CAPS, RUN_BUDGET_MS, eligibleFor, type SeoTarget, type SeoUrl } from "./targets";

/**
 * The SEO worker.
 *
 * Runs from `after()` on the ingest request, so it needs no Vercel cron — a
 * Hobby cron fires once a day, and this wants to be hourly — and no additional
 * invocation: the
 * function is already warm, already authenticated against Supabase, and about
 * to return anyway. Ingestion runs hourly from an Apps Script trigger, which
 * makes this the fastest cadence available on the free tier and a better one
 * than a daily cron would have been.
 *
 * ── The shape of a run ─────────────────────────────────────────────────────
 * For each target: read its watermark, ask for published rows changed since,
 * submit as many as the caps and the clock allow, then move the watermark to
 * the last one actually submitted. Nothing else is stored. A run that fails
 * anywhere leaves the watermark where it was, so the next run repeats the same
 * work rather than skipping it — the recovery for every failure mode here is
 * "wait an hour", which is the property worth having in something nobody will
 * be watching.
 *
 * ── What it costs ──────────────────────────────────────────────────────────
 * Per run: two `seo_ping_state` reads, up to two content queries answered from
 * the partial indexes in migration 0036, one IndexNow POST, up to eight Google
 * POSTs, and a bounded log insert. The content queries return a slug and a
 * timestamp — tens of bytes a row against a 5 GB monthly egress ceiling. This
 * is deliberately not the kind of feature that has to be argued for in
 * `check-traffic-budget.mjs`.
 */

export interface TargetRun {
  /** False when the credentials for this target are absent. */
  configured: boolean;
  submitted: number;
  failed: number;
  /** The watermark after this run, if it moved. */
  watermark?: string | undefined;
  /** Why nothing happened, when nothing did. */
  note?: string | undefined;
}

export interface SeoRun {
  indexnow: TargetRun;
  google: TargetRun;
}

interface StateRow {
  target: string;
  last_url_updated_at: string;
  quota_day: string | null;
  quota_used: number;
}

const OFF = (note: string): TargetRun => ({ configured: false, submitted: 0, failed: 0, note });

/**
 * Entry point. Never throws.
 *
 * The caller is `after()` on the route that writes jobs, and an SEO ping is
 * strictly less important than that route's response. An exception escaping
 * here would be reported as an ingest failure, which is both wrong and the kind
 * of wrong that gets a working pipeline switched off.
 */
export async function runSeoWorker(deadline = Date.now() + RUN_BUDGET_MS): Promise<SeoRun> {
  try {
    return await run(deadline);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[seo] run failed:", message);
    return { indexnow: OFF(message), google: OFF(message) };
  }
}

async function run(deadline: number): Promise<SeoRun> {
  const serverEnv = getServerEnv();
  const db = adminDb();
  const site = env.NEXT_PUBLIC_SITE_URL.replace(/\/+$/, "");

  const { data, error } = await db
    .from("seo_ping_state")
    .select("target, last_url_updated_at, quota_day, quota_used");

  if (error) throw new Error(`could not read seo_ping_state: ${error.message}`);

  const state = new Map<string, StateRow>(data.map((row) => [row.target, row]));

  // Sequential rather than parallel: the two targets share one run budget and
  // one database, and IndexNow — the cheaper and broader of the two — should
  // get its call away before Google's token exchange can eat the clock.
  const indexnow = await runIndexNow(db, site, state.get("indexnow"), serverEnv, deadline);
  const google = await runGoogle(db, site, state.get("google"), serverEnv, deadline);

  return { indexnow, google };
}

/* ── IndexNow ────────────────────────────────────────────────────────────── */

async function runIndexNow(
  db: Db,
  site: string,
  state: StateRow | undefined,
  serverEnv: ReturnType<typeof getServerEnv>,
  deadline: number,
): Promise<TargetRun> {
  const key = serverEnv.INDEXNOW_KEY;
  if (!key) return OFF("INDEXNOW_KEY is not set");
  if (!state) return OFF("no seo_ping_state row for indexnow");
  if (Date.now() > deadline) return OFF("out of time before starting");

  const batch = await candidates(
    db,
    site,
    "indexnow",
    state.last_url_updated_at,
    CAPS.indexNowPerRun,
  );
  if (batch.length === 0) return { configured: true, submitted: 0, failed: 0 };

  const result = await submitToIndexNow(
    { siteUrl: site, key },
    batch.map((row) => row.url),
  );

  // One receipt for the batch, not one per URL. IndexNow accepts or rejects the
  // whole submission, so a row per URL would be the same fact written five
  // hundred times into a table with a retention policy.
  await log(db, [
    {
      target: "indexnow",
      url: `${String(batch.length)} URLs (${batch[0]?.url ?? ""} …)`,
      ok: result.ok,
      http_status: result.status,
      error: result.error ?? null,
    },
  ]);

  if (!result.ok) {
    await saveState(db, "indexnow", {
      last_error: result.error ?? `HTTP ${String(result.status)}`,
    });
    return { configured: true, submitted: 0, failed: batch.length, note: result.error };
  }

  const watermark = highestUpdatedAt(batch);
  await saveState(db, "indexnow", {
    last_url_updated_at: watermark ?? state.last_url_updated_at,
    last_run_urls: batch.length,
    last_error: null,
  });

  return {
    configured: true,
    submitted: batch.length,
    failed: 0,
    watermark: watermark ?? undefined,
  };
}

/* ── Google ──────────────────────────────────────────────────────────────── */

async function runGoogle(
  db: Db,
  site: string,
  state: StateRow | undefined,
  serverEnv: ReturnType<typeof getServerEnv>,
  deadline: number,
): Promise<TargetRun> {
  const clientEmail = serverEnv.GOOGLE_INDEXING_CLIENT_EMAIL;
  const privateKey = serverEnv.GOOGLE_INDEXING_PRIVATE_KEY;
  if (!clientEmail || !privateKey) return OFF("Google service account is not configured");
  if (!state) return OFF("no seo_ping_state row for google");
  if (Date.now() > deadline) return OFF("out of time before starting");

  // The quota is Google's, counted per project per day, and it resets on UTC
  // midnight rather than IST — using the local day here would spend tomorrow's
  // allowance five and a half hours early.
  const today = new Date().toISOString().slice(0, 10);
  const usedToday = state.quota_day === today ? state.quota_used : 0;
  const remaining = CAPS.googleDaily - usedToday;
  if (remaining <= 0)
    return { configured: true, submitted: 0, failed: 0, note: "daily quota spent" };

  const limit = Math.min(CAPS.googlePerRun, remaining);
  const batch = await candidates(db, site, "google", state.last_url_updated_at, limit);
  if (batch.length === 0) return { configured: true, submitted: 0, failed: 0 };

  const { results, authError } = await submitToGoogle(
    { clientEmail, privateKey },
    batch.map((row) => row.url),
    deadline,
  );

  if (authError) {
    await saveState(db, "google", { last_error: authError });
    return { configured: true, submitted: 0, failed: 0, note: authError };
  }

  await log(
    db,
    results.map((r) => ({
      target: "google",
      url: r.url,
      ok: r.ok,
      http_status: r.status,
      error: r.error ?? null,
    })),
  );

  // Over the rows *attempted*, not the rows that succeeded. A 403 on one URL is
  // a permanent answer — the property is not verified, or the page is not a
  // JobPosting — and retrying it every hour would spend the whole quota on the
  // one URL that can never work. The failure is in the log for someone to read.
  const attempted = batch.slice(0, results.length);
  const watermark = highestUpdatedAt(attempted);
  const failed = results.filter((r) => !r.ok).length;

  await saveState(db, "google", {
    last_url_updated_at: watermark ?? state.last_url_updated_at,
    last_run_urls: attempted.length,
    quota_day: today,
    quota_used: usedToday + attempted.length,
    last_error: failed > 0 ? (results.find((r) => !r.ok)?.error ?? "submission failed") : null,
  });

  return {
    configured: true,
    submitted: results.length - failed,
    failed,
    watermark: watermark ?? undefined,
  };
}

/* ── Shared ──────────────────────────────────────────────────────────────── */

/**
 * Published rows changed since the watermark, oldest first.
 *
 * `limit + 1` is not an off-by-one: `trimToCompleteBatch` needs to see the
 * first row it is *not* taking, to know whether the batch stops in the middle
 * of a group of rows sharing one `updated_at`.
 */
async function candidates(
  db: Db,
  site: string,
  target: SeoTarget,
  since: string,
  limit: number,
): Promise<SeoUrl[]> {
  const fetchLimit = limit + 1;

  const jobs = await db
    .from("jobs")
    .select("slug, updated_at")
    .eq("status", "published")
    .gt("updated_at", since)
    .order("updated_at", { ascending: true })
    .limit(fetchLimit);

  if (jobs.error) throw new Error(`seo candidates (jobs): ${jobs.error.message}`);

  const streams: SeoUrl[][] = [
    jobs.data.map((row) => ({
      url: `${site}/jobs/${row.slug}`,
      entity: "job" as const,
      updatedAt: row.updated_at,
    })),
  ];

  if (eligibleFor(target, "update")) {
    const updates = await db
      .from("exam_updates")
      .select("slug, updated_at")
      .eq("is_published", true)
      .gt("updated_at", since)
      .order("updated_at", { ascending: true })
      .limit(fetchLimit);

    if (updates.error) throw new Error(`seo candidates (updates): ${updates.error.message}`);

    streams.push(
      updates.data.map((row) => ({
        url: `${site}/updates/${row.slug}`,
        entity: "update" as const,
        updatedAt: row.updated_at,
      })),
    );
  }

  return trimToCompleteBatch(mergeByUpdatedAt(...streams), limit);
}

async function saveState(
  db: Db,
  target: SeoTarget,
  patch: {
    last_url_updated_at?: string;
    last_run_urls?: number;
    quota_day?: string;
    quota_used?: number;
    last_error?: string | null;
  },
): Promise<void> {
  const { error } = await db
    .from("seo_ping_state")
    .update({ ...patch, last_run_at: new Date().toISOString() })
    .eq("target", target);

  // Logged rather than thrown. The submission already happened; failing the
  // run now would report it as not having happened, and the only consequence
  // of a lost watermark write is that the next run resubmits the same URLs —
  // which both endpoints treat as a no-op.
  if (error) console.error(`[seo] could not save ${target} state:`, error.message);
}

async function log(
  db: Db,
  rows: {
    target: string;
    url: string;
    ok: boolean;
    http_status: number;
    error: string | null;
  }[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await db.from("seo_ping_log").insert(rows);
  if (error) console.error("[seo] could not write ping log:", error.message);
}
