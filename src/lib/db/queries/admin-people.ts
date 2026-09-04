import "server-only";

import { adminOnly, type AdminPage } from "./admin";
import { unwrap } from "../errors";

/**
 * The users and AI-usage pages.
 *
 * `profiles` is owner-only under RLS and holds encrypted identity numbers, so
 * there is no version of this page that selects from the table directly — it
 * goes through `admin_list_users`, whose column list is the privacy policy in
 * executable form. Six fields: name, address, qualification, state, join date,
 * usage. No Aadhaar, no PAN, no passport, no phone, no date of birth, no
 * postal address. They are not fetched-then-hidden; they are never sent.
 *
 * The old page did `select id, user_id, email, full_name, created_at` over
 * every profile with no limit, then a second unbounded read of
 * `education_qualifications`, and reduced both in the browser to show a
 * qualification badge. Both are one paged RPC here.
 */

export interface AdminUserRow {
  id: string;
  email: string | null;
  fullName: string | null;
  highestQualification: string | null;
  state: string | null;
  onboarded: boolean;
  createdAt: string;
  lastSignInAt: string | null;
  /** Lifetime AI calls, summed from the `ai_usage` daily rollup. */
  aiCalls: number;
}

const USER_PAGE = 50;

export async function listUsers(options: {
  page?: number;
  query?: string | undefined;
}): Promise<AdminPage<AdminUserRow>> {
  const db = await adminOnly("listUsers");
  const page = clampPage(options.page);
  // Empty string and undefined both mean "no filter", never "search for
  // nothing".
  const query = options.query?.trim();

  const rows = unwrap(
    "listUsers",
    // `exactOptionalPropertyTypes` will not accept an explicit `undefined` for
    // an optional argument, and it is right not to: PostgREST serialises the
    // key either way, so passing it as undefined sends `"p_query": null`
    // rather than omitting it. Spread, so an absent search really is absent
    // and the function's own default applies.
    await db.rpc("admin_list_users", {
      p_limit: USER_PAGE,
      p_offset: (page - 1) * USER_PAGE,
      ...(query ? { p_query: query } : {}),
    }),
  );

  const total = rows[0]?.total ?? 0;

  return {
    rows: rows.map((row) => ({
      id: row.user_id,
      email: row.email,
      fullName: row.full_name,
      highestQualification: row.highest_qualification,
      state: row.state,
      onboarded: row.onboarding_completed,
      createdAt: row.created_at,
      lastSignInAt: row.last_sign_in_at,
      aiCalls: row.ai_calls,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / USER_PAGE)),
  };
}

export interface UserStats {
  totalUsers: number;
  todayUsers: number;
  weekUsers: number;
  onboardedUsers: number;
  aiCallsToday: number;
}

export async function getUserStats(): Promise<UserStats> {
  const db = await adminOnly("getUserStats");
  const rows = unwrap("getUserStats", await db.rpc("admin_user_stats"));
  const row = rows[0];

  return {
    totalUsers: row?.total_users ?? 0,
    todayUsers: row?.today_users ?? 0,
    weekUsers: row?.week_users ?? 0,
    onboardedUsers: row?.onboarded_users ?? 0,
    aiCallsToday: row?.ai_calls_today ?? 0,
  };
}

/* ── AI usage ──────────────────────────────────────────────────────────── */

export interface AiUsageDay {
  day: string;
  kind: string;
  calls: number;
  users: number;
}

/**
 * Daily AI calls, by feature.
 *
 * `ai_usage` is a rollup keyed on (user, day, kind), so this table grows with
 * accounts rather than with requests — which is why fourteen days of it is a
 * few dozen rows. The old project stored one row per search, with the query
 * text, and read five hundred of them to draw four numbers.
 *
 * The query text is deliberately not stored anywhere. People type their
 * qualifications, their district and sometimes their name into that box; a log
 * of it is a personal-data store whose only consumer is a dashboard.
 */
export async function getAiUsage(days = 14): Promise<AiUsageDay[]> {
  const db = await adminOnly("getAiUsage");
  return unwrap("getAiUsage", await db.rpc("admin_ai_usage", { p_days: days }));
}

function clampPage(page: number | undefined): number {
  if (!page || !Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.trunc(page), 10_000);
}
