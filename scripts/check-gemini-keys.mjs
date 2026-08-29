#!/usr/bin/env node
/**
 * Asks Google, key by key, which of this environment's Gemini keys still work.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The refresh button's failure mode is indistinguishable from every other
 * failure mode: a 503 and "could not reach the status service". Behind it the
 * pool may be entirely dead, entirely rate-limited, or nine-tenths fine — and
 * the only way to tell has been to read the server log of a request that has
 * already spent one of somebody's ten daily refreshes.
 *
 * This asks the same question for free, before the app is involved, and prints
 * an answer per key rather than one verdict for the pool.
 *
 * ── Why it walks the pool the way `keys.ts` does ───────────────────────────
 * It reads the same variables in the same order and de-duplicates the same
 * way, so line 1 of the output is the key the app will try first. A checker
 * that agreed about which keys exist but disagreed about their order would be
 * worse than none: it would clear a pool whose first key is dead, which is
 * exactly the state that costs an attempt on every single request.
 *
 * It deliberately does NOT read `api_keys_config`. That table is checked by
 * the app, has its own error counters, and switches its own dead keys off —
 * this script is for the environment fallback, which remembers nothing.
 *
 * ── What the two calls per key mean ────────────────────────────────────────
 * Grounding carries quota of its own, separately from generation, so a key can
 * be refused for a grounded call and answer an ungrounded one immediately. The
 * app knows this and retries without the tool. So a key that fails grounded is
 * asked again plainly, and the report distinguishes:
 *
 *   ok            answers grounded — fully usable
 *   ungrounded    answers, but not with Google Search — weaker answers, and
 *                 the panel will say "Not searched"
 *   rate limited  a working key inside its window; try again in a minute
 *   dead          Google does not recognise it. No amount of waiting helps
 *
 * Prints a fingerprint, never a key. The variable name is what identifies a
 * key to a person; the hash is only there to show when two names hold the same
 * secret.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *   node scripts/check-gemini-keys.mjs
 *   node scripts/check-gemini-keys.mjs --model gemini-2.5-flash-lite
 *
 * Reads .env.local, or whatever is already exported. Exits non-zero when no
 * key can answer, so it can gate a deploy.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
/** The app's own per-attempt ceiling. A grounded call is genuinely this slow. */
const TIMEOUT_MS = 30_000;

loadEnvLocal();

const modelFlag = process.argv.indexOf("--model");
const MODEL =
  modelFlag === -1
    ? (process.env.GEMINI_MODEL ?? "gemini-2.5-flash")
    : process.argv[modelFlag + 1];

/* ── The pool, in the order `loadApiKeys` builds it ─────────────────────── */

const NUMBERED = Array.from({ length: 9 }, (_, i) => `GEMINI_API_KEY_${String(i + 2)}`);

/** `[variable name, key]`, de-duplicated, first mention winning. */
function poolFromEnv() {
  const named = ["GEMINI_API_KEY", ...NUMBERED].map((name) => [name, process.env[name] ?? ""]);
  const listed = (process.env.GEMINI_API_KEYS ?? "")
    .split(",")
    .map((key, i) => [`GEMINI_API_KEYS[${String(i)}]`, key]);

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

/* ── Asking ────────────────────────────────────────────────────────────── */

async function ask(key, grounded) {
  const body = {
    contents: [{ role: "user", parts: [{ text: "Reply with the single word: ok" }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 16 },
    ...(grounded ? { tools: [{ google_search: {} }] } : {}),
  };

  let response;
  try {
    // Header rather than `?key=`, matching the app — a key in a query string
    // is a key in every proxy log the request passes through.
    response = await fetch(`${ENDPOINT}/${encodeURIComponent(MODEL)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    return {
      verdict: "unreachable",
      detail: error instanceof Error ? error.message : "network",
    };
  }

  if (response.ok) return { verdict: "ok" };

  const text = await response.text().catch(() => "");
  let message = text.slice(0, 120);
  try {
    message = JSON.parse(text).error?.message ?? message;
  } catch {
    // Not JSON. The raw prefix is still the most useful thing to show.
  }

  // The same classification the app makes, and for the same reason: a 400
  // naming the key is permanent, and every other 400 is about the request.
  const dead =
    response.status === 401 ||
    response.status === 403 ||
    /API_KEY_INVALID|API key not valid|API key expired/i.test(text);

  if (dead) return { verdict: "dead", detail: `${String(response.status)} ${message}` };
  if (response.status === 429 || response.status === 402) {
    return { verdict: "rate limited", detail: message };
  }
  return { verdict: "error", detail: `${String(response.status)} ${message}` };
}

async function check(entry) {
  const grounded = await ask(entry.key, true);
  if (grounded.verdict === "ok") return { ...entry, ...grounded };

  // Grounding has its own quota. Refused with the tool is not the same as
  // refused, and the app will fall back — so this asks the way the app would.
  const plain = await ask(entry.key, false);
  if (plain.verdict === "ok") {
    return { ...entry, verdict: "ungrounded", detail: grounded.detail ?? "" };
  }

  return { ...entry, ...plain };
}

/* ── Reporting ─────────────────────────────────────────────────────────── */

const MARK = {
  ok: "✓",
  ungrounded: "~",
  "rate limited": "…",
  dead: "✗",
  error: "✗",
  unreachable: "?",
};

const pool = poolFromEnv();

if (pool.length === 0) {
  console.error("No GEMINI_API_KEY* is set. The refresh button will say the feature is");
  console.error("not configured — see src/lib/ai/keys.ts for every spelling it reads.");
  process.exit(1);
}

console.log(`Model: ${MODEL}`);
console.log(`Keys:  ${String(pool.length)}, in the order the app will try them\n`);

// Sequential on purpose: firing ten grounded calls at once is a good way to
// rate-limit a pool while measuring whether it is rate-limited.
const results = [];
for (const entry of pool) {
  const result = await check(entry);
  results.push(result);

  const fingerprint = createHash("sha256").update(entry.key).digest("hex").slice(0, 8);
  const line = `${MARK[result.verdict] ?? "?"} ${result.name.padEnd(22)} ${fingerprint}  ${result.verdict}`;
  console.log(result.detail ? `${line} — ${result.detail}` : line);
}

const usable = results.filter((r) => r.verdict === "ok" || r.verdict === "ungrounded");
const dead = results.filter((r) => r.verdict === "dead");

console.log(`\n${String(usable.length)} of ${String(pool.length)} keys can answer.`);

if (dead.length > 0) {
  // Worth saying plainly: a dead key costs a wasted attempt on every request
  // until the process that met it restarts, and it sorts first if it is
  // GEMINI_API_KEY.
  console.log(
    `${String(dead.length)} dead: ${dead.map((r) => r.name).join(", ")} — remove or replace them.`,
  );
}

if (usable.length === 0) process.exit(1);

/* ── .env.local, without a dependency ──────────────────────────────────── */

/**
 * Reads .env.local the way dotenv does, which is the way the app does.
 *
 * The subtlety that matters: within one file, a repeated name is resolved
 * **last wins**. This is not a detail — a .env.local with two GEMINI_API_KEY
 * lines is exactly what you get when a key is replaced by pasting a new line
 * rather than editing the old one, and it is precisely then that you reach for
 * this script. Reading first-wins would report on a key the app will never
 * use, which is worse than not checking at all: it is a confident wrong answer
 * about which key is live.
 *
 * Across files and against the shell, first wins: .env.local beats .env, and
 * anything already exported beats both, so a one-off
 * `GEMINI_API_KEY=… node scripts/check-gemini-keys.mjs` checks that key.
 */
function loadEnvLocal() {
  const fromFiles = {};

  for (const name of [".env.local", ".env"]) {
    const file = path.join(ROOT, name);
    if (!existsSync(file)) continue;

    for (const line of readFileSync(file, "utf8").split("\n")) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!match) continue;
      const [, key, raw] = match;
      // Earlier file wins; within a file the later line replaces the earlier.
      if (name !== ".env.local" && key in fromFiles) continue;
      fromFiles[key] = raw.trim().replace(/^["']|["']$/g, "");
    }
  }

  for (const [key, value] of Object.entries(fromFiles)) {
    if (process.env[key]) continue;
    process.env[key] = value;
  }
}
