import { z } from "zod";

/**
 * Environment contract.
 *
 * The whole point of this file is that the app refuses to start on a bad
 * environment, rather than failing later at the first query. A missing key is a
 * boot-time crash with the key's name in it, not a 3am `undefined is not a
 * function`.
 *
 * Two things to know before editing:
 *
 * 1. `NEXT_PUBLIC_*` values are inlined into the client bundle at build time.
 *    They must be referenced as literal `process.env.NEXT_PUBLIC_FOO` property
 *    accesses — a dynamic lookup like `process.env[key]` is NOT replaced by the
 *    bundler and silently reads `undefined` in the browser. That is why the
 *    client block below is written out longhand instead of looping.
 *
 * 2. Anything not prefixed `NEXT_PUBLIC_` must never be imported into a Client
 *    Component. `serverEnv` is guarded by `server-only` for exactly that reason:
 *    importing it from client code is a build error, not a leaked secret.
 */

const url = z.url();
const nonEmpty = z.string().min(1);

/* ── Client — safe to ship to the browser ──────────────────────────────── */

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: nonEmpty,
  NEXT_PUBLIC_SITE_URL: url,

  // The Google OAuth client ID, present so the browser can ask Google for an
  // ID token directly instead of being bounced through Supabase's auth server.
  // Public by design — a client ID is not a credential, and Google's own docs
  // put it in the page — and the matching secret stays in Supabase's dashboard,
  // which is the only party that ever needs it.
  //
  // Optional. Absent, the Google button falls back to the Supabase redirect,
  // which works but makes the consent screen read `<project-ref>.supabase.co`.
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: z.string().optional().or(z.literal("")),
});

const clientParsed = clientSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
});

if (!clientParsed.success) {
  throw new Error(formatIssues("Invalid public environment", clientParsed.error));
}

export const env = clientParsed.data;

/* ── Server — never reaches the browser ────────────────────────────────── */

const serverSchema = z.object({
  // Supabase's new-format secret key (`sb_secret_…`). Bypasses RLS entirely,
  // so it is only ever read by code that genuinely must escape it — the sync
  // worker and the admin role check. Never from a Client Component.
  SUPABASE_SECRET_KEY: nonEmpty,

  // Generated with `openssl rand -hex 32`. The length floor is deliberate:
  // these authenticate cache invalidation and scheduled work, so a short or
  // guessable value is a live denial-of-service vector, not a lint nit.
  REVALIDATE_SECRET: nonEmpty.min(32),
  CRON_SECRET: nonEmpty.min(32),

  // Populated in Module 11. Optional until then so the app boots without them.
  APPS_SCRIPT_WEBAPP_URL: url.optional().or(z.literal("")),
  SHEETS_SYNC_SECRET: z.string().optional(),

  /* ── Push indexing ───────────────────────────────────────────────────── */
  // All three are optional, and the worker treats an absent value as "this
  // target is switched off" rather than as an error. That is the same choice
  // as GEMINI_API_KEY below and for the same reason: a preview deployment, a
  // fork or a local checkout must not be able to announce URLs on the
  // production domain's behalf, and it must still boot.
  //
  // A hex string from `openssl rand -hex 16`. It is not a secret — the whole
  // protocol is that the host serves it back publicly to prove ownership — but
  // it lives in the environment rather than in `public/` so that rotating it
  // is a dashboard edit rather than a commit.
  // The floor is 16 rather than the protocol's 8: the key is served through a
  // `/:key.txt` rewrite at the site root, and a short key would let that
  // pattern shadow a conventional root file — `security.txt` is exactly eight
  // word characters. `openssl rand -hex 16` gives 32.
  INDEXNOW_KEY: z
    .string()
    .min(16)
    .max(128)
    // IndexNow specifies the key as [a-zA-Z0-9-], and it becomes a path
    // segment; anything else would be a URL-shaped surprise.
    .regex(/^[a-zA-Z0-9-]+$/, "INDEXNOW_KEY must be 16-128 chars of [a-zA-Z0-9-]")
    .optional()
    .or(z.literal("")),

  // A Google Cloud service account with the Indexing API enabled, added as an
  // owner of the property in Search Console. Both must be present for the
  // Google target to run; see docs/SEO.md for the setup.
  GOOGLE_INDEXING_CLIENT_EMAIL: z.string().optional(),
  GOOGLE_INDEXING_PRIVATE_KEY: z.string().optional(),

  // Gemini, for the tracker's exam-status refresh. Optional, and deliberately:
  // an environment without a key still boots and still serves every page — the
  // refresh button reports that the feature is not configured rather than the
  // app refusing to start over something only one panel uses.
  GEMINI_API_KEY: z.string().optional(),
  // A comma-separated pool, for spreading free-tier per-key rate limits. Empty
  // in most environments; `GEMINI_API_KEY` alone is a pool of one.
  GEMINI_API_KEYS: z.string().optional(),
  // The numbered pool, written out longhand because that is the naming the old
  // project used and the naming these keys are already stored under. Nine
  // optional lines is a fair price for making an existing setup paste across
  // without being renamed first.
  //
  // The database pool (`api_keys_config`) still wins over all of these — it is
  // the only one that can count errors, cool a key down for 65 seconds, and
  // switch a dead one off. These are the fallback.
  GEMINI_API_KEY_2: z.string().optional(),
  GEMINI_API_KEY_3: z.string().optional(),
  GEMINI_API_KEY_4: z.string().optional(),
  GEMINI_API_KEY_5: z.string().optional(),
  GEMINI_API_KEY_6: z.string().optional(),
  GEMINI_API_KEY_7: z.string().optional(),
  GEMINI_API_KEY_8: z.string().optional(),
  GEMINI_API_KEY_9: z.string().optional(),
  GEMINI_API_KEY_10: z.string().optional(),
  // Overridable because model names are the part of this that ages fastest, and
  // a rename should be an environment variable rather than a deploy. Google
  // Search grounding is a hard requirement of the feature, so a model chosen
  // here must support the `google_search` tool.
  GEMINI_MODEL: nonEmpty.default("gemini-2.5-flash"),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type ServerEnv = z.infer<typeof serverSchema>;

/**
 * Parsed lazily so that importing this module during a client build — which
 * would otherwise throw on the absent secrets — is harmless. Call it from
 * server code only; `src/lib/env.server.ts` re-exports it behind `server-only`.
 */
let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(formatIssues("Invalid server environment", parsed.error));
  }

  cached = parsed.data;
  return cached;
}

/* ── Error formatting ──────────────────────────────────────────────────── */

function formatIssues(heading: string, error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const key = issue.path.join(".") || "(root)";
    return `  • ${key}: ${issue.message}`;
  });

  return [
    "",
    `${heading} — the app cannot start.`,
    ...lines,
    "",
    "Fill these in .env.local (see .env.example), and in Vercel →",
    "Settings → Environment Variables for deployed builds.",
    "",
  ].join("\n");
}
