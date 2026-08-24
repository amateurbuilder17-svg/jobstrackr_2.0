import "server-only";

import { cacheLife } from "next/cache";

import { env } from "@/lib/env";

/**
 * Which third-party sign-in providers this Supabase project actually has
 * enabled.
 *
 * The alternative — an env flag saying "we support Google" — drifts the moment
 * someone toggles the dashboard, and the failure it produces is a button that
 * always returns `400 validation_failed: Unsupported provider`. Asking the auth
 * server means the UI cannot claim a provider the project does not have, and
 * enabling one lights up its button without a redeploy.
 *
 * `/auth/v1/settings` is public, unauthenticated project metadata — it lists
 * which providers are on, and nothing about any user.
 *
 * Cached, so this is one request per revalidation window rather than one per
 * visitor to the sign-in page, and the page keeps its static shell.
 */
export async function enabledOAuthProviders(): Promise<{ google: boolean }> {
  "use cache";
  cacheLife("config");

  const none = { google: false };

  try {
    const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
    });
    if (!response.ok) return none;

    const settings: unknown = await response.json();
    const external = (settings as { external?: Record<string, unknown> }).external;

    return { google: external?.google === true };
  } catch {
    // A sign-in page that renders is worth more than one that 500s because a
    // metadata probe failed. Falling back to "no providers" degrades to
    // email and password, which always works.
    return none;
  }
}
