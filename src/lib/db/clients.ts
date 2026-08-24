import "server-only";

import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { env, getServerEnv } from "@/lib/env";
import type { Database } from "./database.types";

export type Db = SupabaseClient<Database>;

/**
 * Three clients, because they have three genuinely different jobs. Picking the
 * wrong one is the difference between a page that caches and one that does not,
 * or between RLS protecting a row and being bypassed entirely.
 */

/* ── 1. Public: content reads, no session ──────────────────────────────── */

let publicClient: Db | undefined;

/**
 * Anonymous, cookie-free, subject to RLS. Use for all public content.
 *
 * The absence of cookies is the whole point. Reading cookies marks a render
 * dynamic, and a dynamic render is one that hits Supabase per request — which
 * is precisely the behaviour that exhausted the old project's egress quota.
 * This client is safe to call inside a `"use cache"` scope, so the query runs
 * once per revalidation rather than once per visitor.
 *
 * Memoised per process: a warm lambda reuses the connection instead of
 * rebuilding it on every render.
 */
export function publicDb(): Db {
  publicClient ??= createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-client-info": "jobstrackr/public" } },
    },
  );
  return publicClient;
}

/* ── 2. Session: the signed-in user's own data ─────────────────────────── */

/**
 * Cookie-bound, so `auth.uid()` resolves and RLS scopes every row to the
 * current user. Necessarily dynamic — never call it inside a `"use cache"`
 * scope, and never use it to read public content.
 *
 * Not memoised: each request carries its own cookies.
 */
export async function sessionDb(): Promise<Db> {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            for (const { name, value, options } of toSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. Refresh is handled by
            // middleware, so this is expected rather than exceptional.
          }
        },
      },
      global: { headers: { "x-client-info": "jobstrackr/session" } },
    },
  );
}

/* ── 3. Admin: bypasses RLS ────────────────────────────────────────────── */

let adminClient: Db | undefined;

/**
 * Holds the secret key and therefore ignores Row Level Security entirely.
 *
 * Reserved for the ingestion worker and for admin mutations that have already
 * checked `has_role('admin')`. It must never be reachable from a request whose
 * authorisation has not been established first — with this client, RLS is not a
 * second line of defence, because there is no RLS.
 *
 * `server-only` at the top of this module makes importing it from a Client
 * Component a build error rather than a leaked key.
 */
export function adminDb(): Db {
  adminClient ??= createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    getServerEnv().SUPABASE_SECRET_KEY,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-client-info": "jobstrackr/admin" } },
    },
  );
  return adminClient;
}
