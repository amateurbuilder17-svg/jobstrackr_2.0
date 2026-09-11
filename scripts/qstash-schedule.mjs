#!/usr/bin/env node
/**
 * The schedule that makes ingestion happen, kept in git.
 *
 * ── Why QStash, and why this file exists ───────────────────────────────────
 * Ingestion is a pull: `GET /api/ingest` derives its own window and is
 * idempotent, so a scheduler only has to call it. Choosing the scheduler took
 * measurement rather than argument:
 *
 *   GitHub Actions  delivered ~6 of 45 scheduled runs on 2026-09-10, at gaps of
 *                   up to 4½ hours. Scheduled events are best-effort and are
 *                   dropped under load. It stays on as a second caller.
 *   Vercel cron     is once a day on Hobby, and only "within the hour".
 *   cron-job.org    hangs up after 30 s on its free plan; runs take 14–56 s.
 *   Supabase Cron   needs two extensions and a migration, and pg_net has a
 *                   documented failure where its worker stops and requests
 *                   queue silently until someone restarts it.
 *
 * QStash waits up to 15 minutes on the free plan, retries a failed delivery,
 * needs no schema change, and shares no infrastructure with Vercel, Supabase
 * or GitHub.
 *
 * The live schedule is stored in Upstash, not here. That is the same position
 * the Apps Script trigger was in — and its death went unnoticed for days
 * partly because nothing in the repository described it. So this file is the
 * definition: re-running it with --apply restores the schedule exactly, and the
 * fixed schedule ID makes that an update rather than a duplicate.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *
 *   node scripts/qstash-schedule.mjs            # dry run: prints the plan
 *   node scripts/qstash-schedule.mjs --apply    # create or update it
 *   node scripts/qstash-schedule.mjs --list     # what the account holds
 *   node scripts/qstash-schedule.mjs --test     # one call now, through QStash
 *
 * Environment (from .env.local, or exported):
 *   QSTASH_URL    regional host, e.g. https://qstash-us-east-1.upstash.io
 *   QSTASH_TOKEN  the QStash token (not the Redis one)
 *   CRON_SECRET   what /api/ingest expects as its bearer token
 */

import { readFileSync } from "node:fs";

/** www, never the apex: the apex 308s to www and drops the Authorization header. */
const DESTINATION = "https://www.jobstrackr.in/api/ingest";

/** Fixed, so --apply updates the one schedule instead of adding another. */
const SCHEDULE_ID = "jobstrackr-ingest";

/**
 * Off the hour and the half hour, where every multi-tenant scheduler is
 * busiest, and fifteen minutes from the GitHub workflow's nominal 7,37 — so
 * when GitHub does manage to fire, it lands between these runs rather than on
 * top of one.
 */
const CRON = "22,52 * * * *";

/**
 * GET, explicitly. QStash defaults to POST, and `/api/ingest` has no POST
 * handler — every call would 405 and every retry with it.
 */
const METHOD = "GET";

/** The route's own `maxDuration`. Anything shorter retries a run still in progress. */
const TIMEOUT = "300s";

/**
 * Two retries, because the feed fails about one call in three. The route
 * already retries the feed inside a run; these cover a run that failed whole.
 * Each attempt is one message of the free plan's 1,000 a day — the worst case
 * is 48 × 3 = 144.
 */
const RETRIES = "2";

const args = new Set(process.argv.slice(2));

function env() {
  const out = { ...process.env };
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !out[m[1]]) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // Exported into the environment instead. Fine.
  }
  return out;
}

const E = env();
for (const key of ["QSTASH_TOKEN", "CRON_SECRET"]) {
  if (!E[key]) {
    console.error(`missing ${key}`);
    process.exit(1);
  }
}

const base = (E.QSTASH_URL || "https://qstash.upstash.io").replace(/\/+$/, "");
const auth = { Authorization: `Bearer ${E.QSTASH_TOKEN}` };

/** What QStash attaches to every call it makes to the destination. */
const callHeaders = {
  "Upstash-Method": METHOD,
  "Upstash-Timeout": TIMEOUT,
  "Upstash-Retries": RETRIES,
  "Upstash-Label": SCHEDULE_ID,
  // Stripped of its prefix and sent to /api/ingest as `Authorization`.
  "Upstash-Forward-Authorization": `Bearer ${E.CRON_SECRET}`,
};

/** Printable, with the secret replaced by its length. */
const redacted = (headers) =>
  Object.fromEntries(
    Object.entries(headers).map(([k, v]) =>
      /authorization/i.test(k) ? [k, `Bearer <${String(v).length - 7} chars>`] : [k, v],
    ),
  );

async function call(method, path, headers = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...auth, ...headers },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text.slice(0, 300);
  }
  if (!response.ok) {
    console.error(`${method} ${path} → HTTP ${response.status}: ${JSON.stringify(body)}`);
    process.exit(1);
  }
  return body;
}

/** A schedule as it can be shown — never its stored headers, which hold the secret. */
const describe = (s) =>
  `${s.scheduleId}  ${s.cron}  ${s.method ?? "POST"} ${s.destination}  retries=${s.retries ?? "?"}${s.isPaused ? "  PAUSED" : ""}`;

if (args.has("--list")) {
  const schedules = await call("GET", "/v2/schedules");
  console.log(`schedules on ${base}: ${schedules.length}`);
  for (const s of schedules) console.log(`  ${describe(s)}`);
  process.exit(0);
}

if (args.has("--test")) {
  // A one-off message to the same destination with the same headers: proves the
  // method, the forwarded secret and the route end to end without waiting for
  // the next cron tick. It is a real ingest run, and an idempotent one.
  const sent = await call("POST", `/v2/publish/${DESTINATION}`, callHeaders);
  console.log(`test call queued: ${sent.messageId ?? JSON.stringify(sent)}`);
  console.log("check sync_runs in a minute for a jobs and an exam_updates row.");
  process.exit(0);
}

console.log(`host         ${base}`);
console.log(`schedule id  ${SCHEDULE_ID}`);
console.log(`cron (UTC)   ${CRON}`);
console.log(`destination  ${METHOD} ${DESTINATION}`);
console.log(`headers      ${JSON.stringify(redacted(callHeaders))}`);

if (!args.has("--apply")) {
  console.log("\ndry run — nothing sent. Re-run with --apply.");
  process.exit(0);
}

const created = await call("POST", `/v2/schedules/${DESTINATION}`, {
  ...callHeaders,
  "Upstash-Cron": CRON,
  "Upstash-Schedule-Id": SCHEDULE_ID,
});

// Read back rather than trusted: the response only carries the ID, and a
// schedule that exists with the wrong method is exactly the quiet failure this
// file is meant to prevent.
const stored = await call("GET", `/v2/schedules/${created.scheduleId ?? SCHEDULE_ID}`);
console.log(`\nstored: ${describe(stored)}`);
