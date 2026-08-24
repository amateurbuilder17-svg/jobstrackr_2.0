#!/usr/bin/env node
/**
 * Fails the build when a route's first-load JavaScript exceeds its budget.
 *
 * Bundle bloat is not a cosmetic problem here: the previous app shipped 3.2 MB
 * of JS, including an 806 kB ML model that ran in the browser. Nobody chose
 * that in one sitting — it accumulated one unreviewed import at a time. This
 * script makes each of those imports visible at the moment it lands.
 *
 * Measurement is taken from the prerendered HTML rather than from a build
 * manifest: every `<script src>` and `<link rel=preload as=script>` the page
 * emits, gzipped. That is precisely what a visitor downloads and what Vercel
 * bills, and unlike the manifests it does not change shape between Next
 * releases. (Next 16 removed `app-build-manifest.json`, which is what the
 * first version of this script read.)
 *
 * A route with no prerendered HTML cannot be measured this way and is reported
 * as such — loudly, so that "unmeasured" never quietly becomes "unbudgeted".
 *
 * Run after `next build`.
 */
import { gzipSync } from "node:zlib";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nextDir = join(root, ".next");
const appDir = join(nextDir, "server", "app");

if (!existsSync(appDir)) {
  fail(
    `No build output at ${relative(root, appDir)}.\nRun \`pnpm build\` before \`pnpm budget\`.`,
  );
}

const budget = JSON.parse(readFileSync(join(root, "budget.json"), "utf8"));

/* ── Collect prerendered pages ─────────────────────────────────────────── */

const htmlFiles = [];
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith(".html")) htmlFiles.push(full);
  }
})(appDir);

if (htmlFiles.length === 0) {
  fail(
    `No prerendered HTML found under ${relative(root, appDir)}.\n` +
      `Either the build did not run, or no route is static — both are worth\n` +
      `investigating before this check is skipped.`,
  );
}

/* ── Measure ───────────────────────────────────────────────────────────── */

// `noModule` scripts are the legacy-browser polyfill bundle (~38 kB gzipped).
// No browser that supports ES modules requests them, which is every browser
// this app targets — counting them would inflate every route by a constant
// nobody actually pays.
const SCRIPT_TAG = /<script\b[^>]*>/g;
const SRC_ATTR = /\ssrc="(\/_next\/static\/[^"]+\.js)"/;
const NO_MODULE = /\snoModule\b/i;
const PRELOAD = /<link[^>]+rel="preload"[^>]+href="(\/_next\/static\/[^"]+\.js)"/g;

const sizeCache = new Map();
function gzippedKb(assetPath) {
  if (sizeCache.has(assetPath)) return sizeCache.get(assetPath);

  // "/_next/static/chunks/x.js" → ".next/static/chunks/x.js"
  const abs = join(nextDir, assetPath.replace(/^\/_next\//, ""));
  let kb = 0;
  if (existsSync(abs) && statSync(abs).isFile()) {
    kb = gzipSync(readFileSync(abs)).byteLength / 1024;
  }

  sizeCache.set(assetPath, kb);
  return kb;
}

const rows = [];

for (const file of htmlFiles) {
  const route = toRoute(file);
  if (route === "/_global-error") continue;

  const html = readFileSync(file, "utf8");

  // A chunk referenced both as a preload and as a script is downloaded once.
  const assets = new Set();
  const skipped = new Set();

  for (const [tag] of html.matchAll(SCRIPT_TAG)) {
    const src = SRC_ATTR.exec(tag)?.[1];
    if (!src) continue;
    if (NO_MODULE.test(tag)) skipped.add(src);
    else assets.add(src);
  }
  for (const [, href] of html.matchAll(PRELOAD)) {
    if (!skipped.has(href)) assets.add(href);
  }

  if (assets.size === 0) {
    fail(
      `No script tags found in ${relative(root, file)}.\n` +
        `Next.js likely changed how it emits scripts. Fix this script rather\n` +
        `than deleting it — a budget check that silently passes is worse than none.`,
    );
  }

  let kb = 0;
  for (const asset of assets) kb += gzippedKb(asset);

  const limit = budget.routes[route] ?? budget.defaultRouteKb;
  rows.push({ route, kb, limit, chunks: assets.size, over: kb > limit });
}

rows.sort((a, b) => b.kb - a.kb);

/* ── Report ────────────────────────────────────────────────────────────── */

const width = Math.max(...rows.map((r) => r.route.length), 5);

console.log("");
console.log(`  ${"Route".padEnd(width)}   First load   Budget   Chunks`);
console.log(`  ${"─".repeat(width)}   ──────────   ──────   ──────`);

for (const r of rows) {
  console.log(
    `${r.over ? "✗" : " "} ${r.route.padEnd(width)}   ${fmt(r.kb).padStart(10)}   ` +
      `${fmt(r.limit).padStart(6)}   ${String(r.chunks).padStart(6)}`,
  );
}
console.log("");

const failures = rows.filter((r) => r.over);

if (failures.length > 0) {
  const detail = failures
    .map((r) => `  • ${r.route} — ${fmt(r.kb)} against a ${fmt(r.limit)} budget`)
    .join("\n");

  fail(
    `${failures.length} route(s) over budget:\n${detail}\n\n` +
      `Either trim the route — dynamic import, move work to a Server\n` +
      `Component, drop a dependency — or raise its budget in budget.json,\n` +
      `deliberately, in a commit someone reviews.`,
  );
}

const heaviest = rows[0];
console.log(
  `  ✓ ${rows.length} route(s) within budget · heaviest ${heaviest.route} at ${fmt(heaviest.kb)}\n`,
);

/* ── Helpers ───────────────────────────────────────────────────────────── */

function toRoute(file) {
  const rel = relative(appDir, file)
    .split(sep)
    .join("/")
    .replace(/\.html$/, "");
  return rel === "index" ? "/" : `/${rel.replace(/\/index$/, "")}`;
}

function fmt(kb) {
  return `${kb.toFixed(1)} kB`;
}

function fail(message) {
  console.error(`\n✗ Bundle budget\n\n${message}\n`);
  process.exit(1);
}
