import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { adminDb, publicDb } from "@/lib/db/clients";
import type { Json } from "@/lib/db/database.types";
import { tags } from "@/lib/db/tags";
import type { Syllabus } from "@/lib/syllabus/schema";

/**
 * The syllabus cache.
 *
 * Reads go through `publicDb` — no cookies, so a syllabus page can be rendered
 * inside a `"use cache"` scope and served from the CDN. That is the point: the
 * expensive thing happened once, thirty days ago, and everybody since has been
 * served a static page.
 *
 * Writes go through `adminDb`, because the table has no write policy at all.
 * A client-writable cache is a client-writable syllabus, served uncontested to
 * everyone who searches that exam for a month.
 */

const COLUMNS =
  "slug, exam_key, exam_name, year, data, sources, confidence, grounded, model, fetched_at" as const;

export interface CachedSyllabus {
  slug: string;
  examKey: string;
  syllabus: Syllabus;
  grounded: boolean;
  model: string | null;
  fetchedAt: string;
}

/**
 * A cached syllabus by its URL segment, or null.
 *
 * The RLS policy filters expired rows, so a stale entry simply misses here and
 * is refetched. That is deliberate and it is why no cron sweeps this table: an
 * expired syllabus is worse than none, because it is confidently wrong about
 * what somebody is about to spend three months studying.
 */
export async function getSyllabusBySlug(slug: string): Promise<CachedSyllabus | null> {
  "use cache";
  cacheLife("content");
  cacheTag(tags.syllabus(slug));

  const { data, error } = await publicDb()
    .from("syllabus_cache")
    .select(COLUMNS)
    .eq("slug", slug)
    .maybeSingle();

  if (error || !data) return null;
  return toCached(data);
}

/**
 * The same lookup by normalised key, for deciding whether to spend a call.
 *
 * Deliberately NOT cached, unlike the two around it. This one runs inside the
 * search action, where the question is "does this exist right now" — a cached
 * answer would miss an entry written seconds ago by someone else's search and
 * spend a second 30-second model call to rediscover it.
 */
export async function getSyllabusByKey(examKey: string): Promise<CachedSyllabus | null> {
  const { data, error } = await publicDb()
    .from("syllabus_cache")
    .select(COLUMNS)
    .eq("exam_key", examKey)
    .maybeSingle();

  if (error || !data) return null;
  return toCached(data);
}

/**
 * Write a validated syllabus.
 *
 * `slug` is the conflict target rather than `exam_key`, and the difference
 * matters on a refresh: both are derived from the same words, so a re-search of
 * the same exam lands on the same row and replaces it, rather than colliding on
 * the unique index and failing after the model call has already been paid for.
 */
export async function putSyllabus(params: {
  slug: string;
  examKey: string;
  syllabus: Syllabus;
  grounded: boolean;
  model: string;
}): Promise<void> {
  const { error } = await adminDb()
    .from("syllabus_cache")
    .upsert(
      {
        slug: params.slug,
        exam_key: params.examKey,
        exam_name: params.syllabus.examName,
        year: params.syllabus.year,
        // `Json` is the generated jsonb type. The cast is a serialisation
        // boundary rather than a hole: `Syllabus` is plain data by
        // construction — strings, numbers, nulls and arrays of those — so it
        // round-trips through JSON unchanged. TypeScript has no way to say
        // "structurally JSON-safe", which is what this assertion stands in for.
        data: params.syllabus as unknown as Json,
        sources: params.syllabus.sources,
        confidence: params.syllabus.confidence,
        grounded: params.grounded,
        model: params.model,
        fetched_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
      { onConflict: "slug" },
    );

  // Caching is not the transaction. A failed write means the next visitor pays
  // for the call again, which is a cost; throwing here would mean this visitor
  // gets an error page for a syllabus that was fetched successfully, which is a
  // bug. Logged, not raised.
  if (error)
    console.error(`[syllabus] cache write failed for ${params.slug}: ${error.message}`);
}

/** Every cached slug, for the sitemap. */
export async function listSyllabusSlugs(): Promise<{ slug: string; fetchedAt: string }[]> {
  "use cache";
  cacheLife("content");
  cacheTag(tags.syllabusList());

  const { data, error } = await publicDb()
    .from("syllabus_cache")
    .select("slug, fetched_at")
    .order("fetched_at", { ascending: false })
    .limit(500);

  // Degrades to an empty list rather than throwing: this feeds the sitemap,
  // and a sitemap missing its syllabus entries for one cache window is a small
  // self-healing problem, where a throw is a failed build.
  if (error) return [];
  return data.map((row) => ({ slug: row.slug, fetchedAt: row.fetched_at }));
}

interface Row {
  slug: string;
  exam_key: string;
  exam_name: string;
  year: number | null;
  data: unknown;
  sources: string[];
  confidence: number | null;
  grounded: boolean;
  model: string | null;
  fetched_at: string;
}

function toCached(row: Row): CachedSyllabus {
  // `data` is jsonb, so it arrives as `unknown`. The cast is narrowing a
  // deliberately loose transport type rather than papering over an unchecked
  // one: nothing reaches this column without passing the Zod schema first, and
  // the table has no write policy for anything that could bypass it.
  const stored = row.data as Syllabus;

  return {
    slug: row.slug,
    examKey: row.exam_key,
    syllabus: {
      examName: row.exam_name,
      year: row.year,
      stages: stored.stages,
      sources: row.sources,
      confidence: row.confidence,
    },
    grounded: row.grounded,
    model: row.model,
    fetchedAt: row.fetched_at,
  };
}
