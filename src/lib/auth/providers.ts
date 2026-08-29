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
 * Two things this got wrong at first, both of which showed up as "the Google
 * button is gone":
 *
 *   • It failed closed. Any hiccup — the auth server slow, a local Supabase
 *     not up yet — hid the fastest way in, and hid it silently. A button that
 *     might error is better than a sign-in page missing its main path, so an
 *     unreadable probe now assumes the provider is on.
 *
 *   • The answer was cached for a day. Whatever it says, it decides whether a
 *     sign-in button exists, so the `config` cache profile is now measured in
 *     minutes: toggling a provider in the dashboard shows up on the next
 *     revalidation rather than tomorrow.
 */
export async function enabledOAuthProviders(): Promise<{ google: boolean }> {
  "use cache";
  cacheLife("config");

  const settings = await fetchAuthSettings();

  // Only a settings response that explicitly says the provider is off takes
  // the button away — `undefined` here means "could not tell", not "no".
  return { google: settings?.google !== false };
}

async function fetchAuthSettings(): Promise<Record<string, unknown> | undefined> {
  try {
    const response = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY },
    });
    if (!response.ok) return undefined;

    const settings: unknown = await response.json();
    return (settings as { external?: Record<string, unknown> }).external;
  } catch {
    // A sign-in page that renders is worth more than one that 500s because a
    // metadata probe failed.
    return undefined;
  }
}
