#!/usr/bin/env node
/**
 * Moves the Gemini pool out of environment variables and into `api_keys_config`.
 *
 * ── Why a script rather than ten INSERTs ───────────────────────────────────
 * Three things have to be true and are easy to get wrong by hand:
 *
 *   1. **The keys must never appear in a shell history or a transcript.** They
 *      are read from the environment the app already reads them from, so
 *      nobody has to paste a secret anywhere to run this.
 *   2. **A dead key must not be loaded.** The pool sorts by priority and tries
 *      keys in order, so a dead row at priority 0 costs a wasted attempt on
 *      every request until something disables it. Each key is asked to answer
 *      before it is written.
 *   3. **Running it twice must not double the pool.** Keys already in the
 *      table are read back through the decrypting view and skipped.
 *
 * ── What it does not do ────────────────────────────────────────────────────
 * It never deletes, deactivates, or rewrites an existing row. A key in the
 * table that is not in the environment is left exactly as it is — this script
 * adds, and the pool's own bookkeeping does the rest.
 *
 * The `api_keys_encrypt` trigger does the encryption, so what goes over the
 * wire to PostgREST is plaintext under TLS and what lands in the column is
 * PGP-armored. Nothing here handles ciphertext; see migration 0024.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *   node scripts/load-api-keys.mjs                  # dry run, local database
 *   node scripts/load-api-keys.mjs --apply          # write, local database
 *   node scripts/load-api-keys.mjs --remote         # dry run, the real project
 *   node scripts/load-api-keys.mjs --remote --apply # write, the real project
 *
 *   --no-check   skip asking Google whether each key works (loads dead keys)
 *
 * Dry run by default, and local by default, because the failure mode of the
 * other defaults is ten bad rows in production.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

const APPLY = process.argv.includes("--apply");
const REMOTE = process.argv.includes("--remote");
const CHECK = !process.argv.includes("--no-check");

/* ── Where the keys come from, and where the rows go ────────────────────── */

// The keys always come from .env.local — it is the file that holds them, for
// both targets. Only the database credentials differ.
const local = readEnvFile(".env.development.local");
const shared = readEnvFile(".env.local");

const KEY_ENV = { ...shared, ...pickGemini(process.env) };
const target = REMOTE ? shared : { ...shared, ...local };

const SUPABASE_URL = target.NEXT_PUBLIC_SUPABASE_URL;
const SECRET_KEY = target.SUPABASE_SECRET_KEY;
const MODEL = KEY_ENV.GEMINI_MODEL ?? "gemini-2.5-flash";

if (!SUPABASE_URL || !SECRET_KEY) {
  fail(
    `No database credentials for the ${REMOTE ? "remote" : "local"} target.\n` +
      `Expected NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in ` +
      `${REMOTE ? ".env.local" : ".env.development.local"}.`,
  );
}

/* ── The pool, in the order `loadApiKeys` builds it ─────────────────────── */

const NUMBERED = Array.from({ length: 9 }, (_, i) => `GEMINI_API_KEY_${String(i + 2)}`);

function pickGemini(env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (k.startsWith("GEMINI_")) out[k] = v;
  return out;
}

function poolFromEnv() {
  const named = ["GEMINI_API_KEY", ...NUMBERED].map((name) => [name, KEY_ENV[name] ?? ""]);
  const listed = (KEY_ENV.GEMINI_API_KEYS ?? "")
    .split(",")
    .map((key, i) => [`GEMINI_API_KEYS_${String(i + 1)}`, key]);

  const seen = new Set();
  const pool = [];

  for (const [name, raw] of [...named, ...listed]) {
    const key = raw.trim();
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    pool.push({ name, key });
  }

  return pool;
}

/* ── PostgREST ─────────────────────────────────────────────────────────── */

async function rest(pathname, init = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathname}`, {
    ...init,
    headers: {
      apikey: SECRET_KEY,
      Authorization: `Bearer ${SECRET_KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`${String(response.status)} ${text.slice(0, 300)}`);
  return text === "" ? null : JSON.parse(text);
}

/** Whether Google will answer with this key. Grounded, because the app grounds. */
async function works(key) {
  const response = await fetch(`${ENDPOINT}/${encodeURIComponent(MODEL)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "Reply with: ok" }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 16 },
      tools: [{ google_search: {} }],
    }),
    signal: AbortSignal.timeout(30_000),
  }).catch((error) => ({ ok: false, status: 0, detail: String(error) }));

  if (response.ok) return { ok: true };

  // A rate-limited key is a working key inside its window, and grounding
  // carries quota of its own — refusing to load it would be the wrong lesson
  // to draw from a 429.
  if (response.status === 429 || response.status === 402)
    return { ok: true, note: "rate limited" };

  const text = (await response.text?.().catch(() => "")) ?? "";
  let message = text.slice(0, 100);
  try {
    message = JSON.parse(text).error?.message ?? message;
  } catch {
    // Not JSON — the raw prefix is still the most useful thing to show.
  }
  return { ok: false, note: `${String(response.status)} ${message}` };
}

/* ── The run ───────────────────────────────────────────────────────────── */

const pool = poolFromEnv();
if (pool.length === 0) fail("No GEMINI_API_KEY* is set. Nothing to load.");

console.log(`Target:   ${SUPABASE_URL} (${REMOTE ? "remote" : "local"})`);
console.log(`Model:    ${MODEL}`);
console.log(`Found:    ${String(pool.length)} keys in the environment`);
console.log(`Mode:     ${APPLY ? "APPLY — rows will be written" : "dry run"}\n`);

// Every row, including inactive ones: a key that was disabled for being dead
// must not be re-added as a shiny new row at the front of the pool.
const existing = await rest(
  "decrypted_api_keys_config?select=api_key,label,is_active,priority",
);
const known = new Set(existing.map((r) => r.api_key).filter(Boolean));
const maxPriority = existing.reduce((max, r) => Math.max(max, r.priority ?? 0), -1);

const toLoad = [];

for (const entry of pool) {
  const fingerprint = createHash("sha256").update(entry.key).digest("hex").slice(0, 8);
  const label = `${entry.name} ${fingerprint}`;

  if (known.has(entry.key)) {
    console.log(`= ${entry.name.padEnd(22)} ${fingerprint}  already in the table`);
    continue;
  }

  if (CHECK) {
    const verdict = await works(entry.key);
    if (!verdict.ok) {
      console.log(`✗ ${entry.name.padEnd(22)} ${fingerprint}  skipped — ${verdict.note}`);
      continue;
    }
    console.log(
      `+ ${entry.name.padEnd(22)} ${fingerprint}  will load${verdict.note ? ` (${verdict.note})` : ""}`,
    );
  } else {
    console.log(`+ ${entry.name.padEnd(22)} ${fingerprint}  will load (unchecked)`);
  }

  toLoad.push({
    provider: "gemini",
    api_key: entry.key,
    // Written explicitly rather than left to the column default, because the
    // default is only correct on a database that has migration 0025. Both of
    // this project's databases were found without it, still defaulting to
    // gemini-3.5-flash — a model measured to return 429 on every grounded call
    // and MALFORMED_FUNCTION_CALL on every ungrounded one. Ten rows carrying
    // that model is a pool that cannot answer, and nothing in the failure says
    // why. A row states its own model; that is what the column is for.
    model_name: MODEL,
    priority: maxPriority + 1 + toLoad.length,
    label,
    is_active: true,
  });
}

console.log(`\n${String(toLoad.length)} to load, ${String(known.size)} already present.`);

if (toLoad.length === 0) process.exit(0);

if (!APPLY) {
  console.log("Dry run. Re-run with --apply to write them.");
  process.exit(0);
}

await rest("api_keys_config", { method: "POST", body: JSON.stringify(toLoad) });

// Read back through the decrypting view rather than trusting the insert. The
// trigger encrypts and the view decrypts; if either is missing on this project
// the pool would load `null` keys and the feature would fail with no clue why.
const after = await rest(
  "decrypted_api_keys_config?select=label,api_key,is_active&order=priority",
);
const readable = after.filter((r) => r.api_key).length;

console.log(`\nWrote ${String(toLoad.length)} rows.`);
console.log(
  `The pool now holds ${String(after.length)} keys, ${String(readable)} of them readable.`,
);

if (readable !== after.length) {
  fail("Some rows did not decrypt. Check the vault secret api_keys_encryption_key.");
}

console.log("\nRemove the GEMINI_API_KEY* values from .env.local and Vercel once you have");
console.log("confirmed a refresh works — leaving them behind adds a location rather than");
console.log("moving one. The table wins over them either way.");

/* ── .env files, without a dependency ──────────────────────────────────── */

function readEnvFile(name) {
  const file = path.join(ROOT, name);
  if (!existsSync(file)) return {};

  const out = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
