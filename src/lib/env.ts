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
});

const clientParsed = clientSchema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
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
