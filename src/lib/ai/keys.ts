import "server-only";

import { adminDb } from "@/lib/db/clients";
import type { Database } from "@/lib/db/database.types";
import { getServerEnv } from "@/lib/env.server";

/**
 * The key pool, and what rotation does to it.
 *
 * Gemini 3.5 Flash on the free tier is capped per minute and per day, and both
 * caps arrive as a `429`. So the pool is not an optimisation — it is the thing
 * that decides whether the feature answers at all at 9am when everyone opens
 * their tracker at once. Ten keys, tried in order, each one rotated past the
 * moment it says no.
 *
 * This is the old project's `_shared/apiKeyRotation.ts` cycle, unchanged in
 * behaviour:
 *
 *   • keys come from `decrypted_api_keys_config`, ordered by priority then by
 *     how many errors each has accumulated
 *   • a key that returned 429 in the last 65 seconds sorts to the **back** of
 *     the queue rather than being dropped — it is still the answer when every
 *     other key is spent
 *   • a 401 or 403 is not a cooldown, it is a dead key: `is_active` goes false
 *     and it stops being loaded at all
 *   • every outcome is written back, so the table says which key is carrying
 *     the load and which one quietly stopped working
 *
 * The stat writes are deliberately not awaited. They are bookkeeping; making a
 * user's refresh wait on them would add a round trip to the slowest request in
 * the app to record something nobody is reading in that moment.
 */

/** Slightly longer than Gemini's one-minute window, so a cooled key is truly free. */
const COOLDOWN_MS = 65_000;

export interface ApiKey {
  /** `env-N` for a key that came from the environment; those get no DB writes. */
  id: string;
  provider: string;
  model: string;
  key: string;
  label: string;
  totalCalls: number;
  totalErrors: number;
}

/* ── Loading ───────────────────────────────────────────────────────────── */

/**
 * Every column arrives nullable, and that is the view rather than the data.
 *
 * The columns are `not null` on `api_keys_config`, but PostgREST cannot see
 * through `decrypted_api_keys_config` to say so, and the type generator
 * believes it. Rather than assert the nullability away, the loader treats a
 * null in any required field as "skip this key" — which is the correct
 * handling for the one column that genuinely can be null anyway: `api_key`,
 * when `decrypt_api_key` refuses or fails.
 */
type KeyRow = Pick<
  Database["public"]["Views"]["decrypted_api_keys_config"]["Row"],
  | "id"
  | "provider"
  | "model_name"
  | "api_key"
  | "priority"
  | "label"
  | "last_error"
  | "total_calls"
  | "total_errors"
  | "updated_at"
>;

/** True while a key is inside the window it was rate-limited in. */
function coolingDown(row: Pick<KeyRow, "last_error" | "updated_at">, now: number): boolean {
  if (!row.last_error?.startsWith("429:")) return false;
  if (row.updated_at === null) return false;
  return now - new Date(row.updated_at).getTime() < COOLDOWN_MS;
}

/**
 * The pool, in the order to try it.
 *
 * Database first, environment as a fallback — a deployment with no rows still
 * works, which is what keeps this from being a hard dependency for anyone
 * running the app locally. A database that is reachable but empty falls back
 * too; only a populated table wins.
 *
 * Gemini only. The other providers the table can hold do not carry Google
 * Search grounding, and an ungrounded answer about this week's admit card is
 * the failure this whole feature exists to avoid. A Groq key in the pool is
 * therefore skipped rather than silently producing a worse answer.
 */
export async function loadApiKeys(): Promise<ApiKey[]> {
  const fromDb = await loadFromDatabase();
  if (fromDb.length > 0) return fromDb;
  return loadFromEnv();
}

async function loadFromDatabase(): Promise<ApiKey[]> {
  let rows: KeyRow[];

  try {
    const { data, error } = await adminDb()
      .from("decrypted_api_keys_config")
      .select(
        "id, provider, model_name, api_key, priority, label, last_error, total_calls, total_errors, updated_at",
      )
      .eq("is_active", true)
      .eq("provider", "gemini")
      .order("priority", { ascending: true })
      .order("total_errors", { ascending: true })
      .limit(50);

    if (error) {
      // Not fatal. The environment fallback is right there, and a feature that
      // dies because a stats table was unreachable is worse than one that runs
      // on a single key for an hour.
      console.warn(`[ai:keys] could not read the pool: ${error.message}`);
      return [];
    }
    rows = data;
  } catch (cause) {
    console.warn("[ai:keys] could not read the pool:", cause);
    return [];
  }

  const now = Date.now();
  const fresh: ApiKey[] = [];
  const cooling: ApiKey[] = [];

  for (const row of rows) {
    // A null `api_key` means the caller was not authorised or the ciphertext no
    // longer decrypts — see `decrypt_api_key`. Either way this key cannot be
    // used, and skipping beats sending "null" to Google and blaming the key.
    if (!row.api_key || !row.id || !row.model_name) continue;

    const key: ApiKey = {
      id: row.id,
      provider: row.provider ?? "gemini",
      model: row.model_name,
      key: row.api_key,
      label: row.label ?? row.id.slice(0, 8),
      totalCalls: row.total_calls ?? 0,
      totalErrors: row.total_errors ?? 0,
    };

    (coolingDown(row, now) ? cooling : fresh).push(key);
  }

  // Worth saying out loud only when it is bad news: no key is ready and every
  // call is about to go to one that is still inside its rate-limit window.
  if (fresh.length === 0 && cooling.length > 0) {
    console.warn(`[ai:keys] all ${String(cooling.length)} keys are cooling down`);
  }

  // Cooling keys go last, not away: when every fresh key is spent, a key whose
  // minute has nearly elapsed is still the best remaining option.
  return [...fresh, ...cooling];
}

/**
 * The fallback pool.
 *
 * Three spellings, because three exist in the wild and renaming someone's
 * working environment is not a prerequisite for this feature:
 *
 *   GEMINI_API_KEY            the single key every environment has
 *   GEMINI_API_KEY_2 … _10    the numbered pool, as the old project named it
 *   GEMINI_API_KEYS           a comma-separated list, for one variable
 *
 * All three are read and de-duplicated, so a key named twice is tried once.
 *
 * What this pool cannot do is the part that matters at scale: nothing here
 * survives the request. A 429 on key 3 is forgotten the moment the function
 * returns, so the next request walks into the same rate-limited key again.
 * That is why `api_keys_config` wins when it has rows — the cooldown, the error
 * counts and the dead-key switch all need somewhere to be written down.
 */
function loadFromEnv(): ApiKey[] {
  const env = getServerEnv();
  const seen = new Set<string>();

  const candidates = [
    env.GEMINI_API_KEY,
    env.GEMINI_API_KEY_2,
    env.GEMINI_API_KEY_3,
    env.GEMINI_API_KEY_4,
    env.GEMINI_API_KEY_5,
    env.GEMINI_API_KEY_6,
    env.GEMINI_API_KEY_7,
    env.GEMINI_API_KEY_8,
    env.GEMINI_API_KEY_9,
    env.GEMINI_API_KEY_10,
    ...(env.GEMINI_API_KEYS ?? "").split(","),
  ];

  for (const raw of candidates) {
    const trimmed = (raw ?? "").trim();
    if (trimmed !== "") seen.add(trimmed);
  }

  return [...seen].map((key, i) => ({
    id: `env-${String(i)}`,
    provider: "gemini",
    model: env.GEMINI_MODEL,
    key,
    label: `env key ${String(i + 1)}`,
    totalCalls: 0,
    totalErrors: 0,
  }));
}

/* ── Recording what happened ───────────────────────────────────────────── */

/** Environment keys have no row to write to. */
function isStored(key: ApiKey): boolean {
  return !key.id.startsWith("env-");
}

type KeyPatch = Database["public"]["Tables"]["api_keys_config"]["Update"];

/**
 * Fire-and-forget. A rejected promise here must not reject the caller's
 * request — the answer is already on its way to somebody.
 */
function write(key: ApiKey, patch: KeyPatch, what: string): void {
  if (!isStored(key)) return;

  void adminDb()
    .from("api_keys_config")
    .update(patch)
    .eq("id", key.id)
    .then(({ error }) => {
      if (error)
        console.warn(`[ai:keys] could not record ${what} for ${key.label}: ${error.message}`);
    });
}

export function recordSuccess(key: ApiKey): void {
  write(
    key,
    {
      last_used_at: new Date().toISOString(),
      total_calls: key.totalCalls + 1,
      last_error: null,
    },
    "a call",
  );
}

/**
 * A key that is out of quota for the minute or the day.
 *
 * `updated_at` is written explicitly. The trigger would set it anyway, but the
 * cooldown is read as `last_error starts with '429:' AND updated_at is recent`,
 * and a cooldown that depends on a trigger somebody might drop is a cooldown
 * that silently stops working.
 */
export function recordRateLimit(key: ApiKey, status: number): void {
  write(
    key,
    {
      last_error: `429: rate limited or exhausted (${String(status)})`,
      total_errors: key.totalErrors + 1,
      updated_at: new Date().toISOString(),
    },
    "a rate limit",
  );
}

/**
 * A key that is revoked, restricted, or was never valid.
 *
 * Switched off rather than left to fail on every future call. Ten keys where
 * two are dead is a pool that wastes two attempts on every single request, and
 * the waste is invisible until someone reads the error counters.
 */
export function recordDeadKey(key: ApiKey, status: number, detail: string): void {
  write(
    key,
    {
      is_active: false,
      last_error: `${String(status)}: ${detail.slice(0, 200)}`,
      total_errors: key.totalErrors + 1,
    },
    "a dead key",
  );
}

/** Anything else — a bad model name, a 500 from Google. Recorded, not disabled. */
export function recordError(key: ApiKey, status: number, detail: string): void {
  write(
    key,
    {
      last_error: `${String(status)}: ${detail.slice(0, 200)}`,
      total_errors: key.totalErrors + 1,
    },
    "an error",
  );
}
