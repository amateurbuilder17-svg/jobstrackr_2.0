import "server-only";

import { adminOnly, type AdminPage } from "./admin";
import { sessionDb } from "../clients";
import { PAGE_SIZE } from "../cursor";
import { unwrap } from "../errors";
import type { FeedbackKind } from "@/lib/feedback/kinds";

/**
 * The suggestions and grievances inbox.
 *
 * Reads go through the ordinary session client, not the secret key — unusually
 * for this folder, and worth saying why. `suggestions_owner_select` (0010)
 * already reads `... or public.has_role('admin')`, so RLS itself grants an
 * admin every row. Reaching for `adminDb()` here would replace a policy the
 * database enforces with a check in application code, which is the wrong
 * direction: the secret key is for questions RLS cannot answer, not for
 * questions it already answers correctly.
 *
 * The write is the other way round. There is no `grant update` on this table
 * and no update policy — correct, for something anyone on the internet can
 * insert into — so moving a submission's status goes through a narrow
 * `security definer` function that can change the status and nothing else.
 */

export type FeedbackStatus = "open" | "triaged" | "resolved" | "spam";

const STATUSES: readonly FeedbackStatus[] = ["open", "triaged", "resolved", "spam"];

export function asFeedbackStatus(value: string | undefined): FeedbackStatus | undefined {
  return STATUSES.find((s) => s === value);
}

const KINDS: readonly FeedbackKind[] = ["suggestion", "grievance"];

export function asFeedbackKind(value: string | undefined): FeedbackKind | undefined {
  return KINDS.find((k) => k === value);
}

export interface FeedbackRow {
  id: string;
  kind: string;
  status: string;
  message: string;
  /** Null for an anonymous submission — the form does not require one. */
  email: string | null;
  /** Whether it came from a signed-in account. The id itself is not needed. */
  fromAccount: boolean;
  createdAt: string;
}

export async function listFeedback(options: {
  page?: number;
  status?: FeedbackStatus | undefined;
  kind?: FeedbackKind | undefined;
  query?: string | undefined;
}): Promise<AdminPage<FeedbackRow>> {
  const db = await sessionDb();
  const page = clampPage(options.page);
  const from = (page - 1) * PAGE_SIZE.admin;

  let q = db
    .from("suggestions_grievances")
    // `count: 'exact'` with a range returns the total in a header rather than
    // as rows — the same trick the rest of the admin tables use.
    .select("id, kind, status, message, email, user_id, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE.admin - 1);

  if (options.status) q = q.eq("status", options.status);
  if (options.kind) q = q.eq("kind", options.kind);

  const search = options.query?.trim();
  if (search) {
    // `,` separates OR branches in PostgREST's grammar, so a comma in the search
    // term would be read as a new condition rather than as text. Stripped rather
    // than escaped: there is no escape for it in this position, and a comma is
    // not something anyone searches an inbox by.
    const safe = search.replace(/[,()]/g, " ").trim();
    if (safe) q = q.or(`message.ilike.%${safe}%,email.ilike.%${safe}%`);
  }

  const result = await q;
  const rows = unwrap("listFeedback", result);

  return {
    rows: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      message: row.message,
      email: row.email,
      fromAccount: row.user_id !== null,
      createdAt: row.created_at,
    })),
    total: result.count ?? 0,
    page,
    pageCount: Math.max(1, Math.ceil((result.count ?? 0) / PAGE_SIZE.admin)),
  };
}

export interface FeedbackCounts {
  open: number;
  triaged: number;
  resolved: number;
  spam: number;
  /** Open grievances — something is broken and nobody has looked at it yet. */
  openGrievances: number;
}

export async function getFeedbackCounts(): Promise<FeedbackCounts> {
  const db = await adminOnly("getFeedbackCounts");
  const rows = unwrap("getFeedbackCounts", await db.rpc("admin_feedback_counts"));
  const row = rows[0];

  return {
    open: row?.open_count ?? 0,
    triaged: row?.triaged_count ?? 0,
    resolved: row?.resolved_count ?? 0,
    spam: row?.spam_count ?? 0,
    openGrievances: row?.open_grievances ?? 0,
  };
}

function clampPage(page: number | undefined): number {
  if (!page || !Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.trunc(page), 10_000);
}
