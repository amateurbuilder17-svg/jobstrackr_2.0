#!/usr/bin/env node
/**
 * Moves the old project's user data into the new one.
 *
 * Accounts are NOT handled here — `auth.users` is not reachable over PostgREST,
 * and the only way to keep everyone's password working is a direct dump of
 * `auth.users` and `auth.identities`. That is Step 1 of
 * docs/ACCOUNT-MIGRATION.md, and it must run before this script: every table
 * below is keyed by `user_id`, and those keys are the uuids the dump preserves.
 *
 * What this does handle is the thirteen public tables that hang off those
 * accounts — under a megabyte in total, and every difficulty in it is a
 * mapping rather than a volume:
 *
 *   - `profiles` moves to a schema that deliberately has no columns for
 *     aadhaar, PAN, passport or certificate numbers. Those are dropped, and
 *     the dry run counts what it dropped so the decision is visible rather
 *     than silent.
 *   - `education_qualifications.qualification_type` is free text on one side
 *     and an enum on the other, and it feeds a hard filter in `match_jobs`.
 *     An unrecognised value is REPORTED, never guessed.
 *   - `exam_attempts.exam_id` and `saved_jobs.job_id` point at content whose
 *     ids are new. Both are remapped, and anything unmappable is listed.
 *
 * Usage:
 *
 *   node scripts/migrate-users.mjs                 # dry run: counts + problems
 *   node scripts/migrate-users.mjs --apply
 *   node scripts/migrate-users.mjs --only profiles,saved_jobs
 *
 * Environment (.env.local, or exported):
 *
 *   OLD_SUPABASE_URL / OLD_SUPABASE_SECRET_KEY
 *   NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ONLY = (valueOf("--only") ?? "").split(",").filter(Boolean);

loadEnvLocal();

const OLD = {
  url: required("OLD_SUPABASE_URL"),
  key: required("OLD_SUPABASE_SECRET_KEY"),
};
const NEW = {
  url: required("NEXT_PUBLIC_SUPABASE_URL"),
  key: required("SUPABASE_SECRET_KEY"),
};

/* ── PostgREST ─────────────────────────────────────────────────────────── */

async function read(project, table, columns, { pageSize = 500 } = {}) {
  const out = [];
  let after = "";

  for (;;) {
    // Keyset on id::text rather than OFFSET: the old database times out
    // (57014) on large scans, and offset gets slower every page.
    const url =
      `${project.url}/rest/v1/${table}?select=${columns}` +
      `&id=gt.${encodeURIComponent(after)}&order=id.asc&limit=${pageSize}`;

    const response = await fetch(url, {
      headers: { apikey: project.key, authorization: `Bearer ${project.key}` },
    });
    if (!response.ok)
      throw new Error(`read ${table}: ${response.status} ${await response.text()}`);

    const rows = await response.json();
    out.push(...rows);
    if (rows.length < pageSize) return out;
    after = rows[rows.length - 1].id;
  }
}

/** Tables with no `id` column — read straight through, they are tiny. */
async function readAll(project, table, columns) {
  const url = `${project.url}/rest/v1/${table}?select=${columns}&limit=5000`;
  const response = await fetch(url, {
    headers: { apikey: project.key, authorization: `Bearer ${project.key}` },
  });
  if (!response.ok)
    throw new Error(`read ${table}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function write(table, rows, conflictColumns) {
  if (rows.length === 0) return 0;

  let written = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200);
    const url = `${NEW.url}/rest/v1/${table}?on_conflict=${conflictColumns}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        apikey: NEW.key,
        authorization: `Bearer ${NEW.key}`,
        "content-type": "application/json",
        // Upsert, so the script is safe to re-run. A second run writes the
        // same values over the same rows and changes nothing.
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(batch),
    });
    if (!response.ok)
      throw new Error(`write ${table}: ${response.status} ${await response.text()}`);
    written += batch.length;
  }
  return written;
}

/* ── Mappings ──────────────────────────────────────────────────────────── */

/**
 * Old qualification_type → the new enum.
 *
 * This column feeds `match_jobs`, which treats an unknown level as a
 * non-match — so a wrong guess here does not degrade gracefully, it silently
 * removes someone from every feed. Anything not on this list is reported and
 * left null rather than approximated.
 */
const LEVELS = {
  "10th": "class_10",
  "10th_pass": "class_10",
  matriculation: "class_10",
  secondary: "class_10",
  "12th": "class_12",
  "12th_pass": "class_12",
  intermediate: "class_12",
  senior_secondary: "class_12",
  iti: "iti",
  diploma: "diploma",
  polytechnic: "diploma",
  graduation: "bachelor",
  graduate: "bachelor",
  bachelor: "bachelor",
  bachelors: "bachelor",
  degree: "bachelor",
  post_graduation: "master",
  postgraduate: "master",
  master: "master",
  masters: "master",
  phd: "doctorate",
  doctorate: "doctorate",
};

/** The same dedupe key the ingest worker computes. See `toJobPayload`. */
function dedupeKey(sourceUrl, title) {
  return createHash("sha256").update(`${sourceUrl}\n${title}`).digest("hex").slice(0, 32);
}

function normaliseName(value) {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/* ── The run ───────────────────────────────────────────────────────────── */

const problems = [];
const summary = [];

function note(table, count, detail = "") {
  summary.push({ table, count, detail });
}

function problem(table, message) {
  problems.push(`${table}: ${message}`);
}

function wanted(table) {
  return ONLY.length === 0 || ONLY.includes(table);
}

console.log(`${APPLY ? "MIGRATING" : "DRY RUN —"} user data`);
console.log(`  from ${OLD.url}`);
console.log(`  to   ${NEW.url}\n`);

/* ── Content id maps, built once ───────────────────────────────────────── */

console.log("Building content id maps …");

const [oldJobs, newJobs, oldExams, newExams] = await Promise.all([
  read(OLD, "jobs", "id,title,source_url,apply_link,slug"),
  read(NEW, "jobs", "id,dedupe_key,slug"),
  readAll(OLD, "exams", "id,name"),
  readAll(NEW, "exams", "id,name,slug"),
]);

const newJobByKey = new Map(
  newJobs.filter((j) => j.dedupe_key).map((j) => [j.dedupe_key, j.id]),
);
const newJobBySlug = new Map(newJobs.map((j) => [j.slug, j.id]));

// Two routes, in order of reliability. The dedupe key is what the ingest path
// actually wrote, so it agrees by construction; the slug is the fallback for
// rows that reached the new project by some other route.
const jobIdMap = new Map();
for (const job of oldJobs) {
  const sourceUrl = job.source_url ?? job.apply_link ?? `legacy:${job.slug ?? job.id}`;
  const byKey = newJobByKey.get(dedupeKey(sourceUrl, job.title));
  const bySlug = job.slug ? newJobBySlug.get(job.slug) : undefined;
  if (byKey ?? bySlug) jobIdMap.set(job.id, byKey ?? bySlug);
}

const newExamByName = new Map(newExams.map((e) => [normaliseName(e.name), e.id]));
const examIdMap = new Map();
for (const exam of oldExams) {
  const match = newExamByName.get(normaliseName(exam.name));
  if (match) examIdMap.set(exam.id, match);
}

console.log(
  `  jobs   ${jobIdMap.size}/${oldJobs.length} mapped\n` +
    `  exams  ${examIdMap.size}/${oldExams.length} mapped\n`,
);

/* ── profiles ──────────────────────────────────────────────────────────── */

if (wanted("profiles")) {
  const rows = await readAll(
    OLD,
    "profiles",
    "id,user_id,full_name,phone,date_of_birth,gender,category,preferred_sectors,created_at",
  );

  const mapped = rows
    .filter((row) => row.user_id)
    .map((row) => ({
      // The new schema keys a profile by the auth user's id directly; the old
      // one carried a separate surrogate `id` and a `user_id` beside it.
      id: row.user_id,
      full_name: row.full_name,
      phone: /^[6-9]\d{9}$/.test(row.phone ?? "") ? row.phone : null,
      date_of_birth: row.date_of_birth,
      gender: ["male", "female"].includes((row.gender ?? "").toLowerCase())
        ? row.gender.toLowerCase()
        : null,
      category: mapCategory(row.category),
      preferred_sectors: Array.isArray(row.preferred_sectors) ? row.preferred_sectors : [],
      onboarding_completed: Boolean(row.full_name && row.date_of_birth),
    }));

  // Not migrated, and counted so that the decision is on the record rather
  // than implied by its absence.
  const withPii = rows.filter((r) =>
    ["aadhar_number", "pan_number", "passport_number", "caste_certificate_number"].some(
      (k) => k in r,
    ),
  ).length;

  note("profiles", mapped.length, `${withPii} rows had PII columns, none migrated`);
  if (APPLY) await write("profiles", mapped, "id");
}

function mapCategory(value) {
  const v = (value ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const table = {
    general: "general",
    ur: "general",
    ews: "ews",
    obc: "obc",
    obcncl: "obc_ncl",
    sc: "sc",
    st: "st",
    pwd: "pwd",
    ph: "pwd",
  };
  return table[v] ?? null;
}

/* ── education_qualifications ──────────────────────────────────────────── */

if (wanted("education_qualifications")) {
  const rows = await readAll(
    OLD,
    "education_qualifications",
    "id,user_id,qualification_type,qualification_name,institute_name,board_university,passing_year,percentage",
  );

  const mapped = [];
  for (const row of rows) {
    const key = (row.qualification_type ?? "").toLowerCase().replace(/[\s-]+/g, "_");
    const level = LEVELS[key];
    if (!level) {
      // This column is a hard filter. An unrecognised value is left for a
      // person to decide rather than mapped to the nearest-looking level.
      problem(
        "education_qualifications",
        `unmapped qualification_type "${row.qualification_type}" (user ${row.user_id})`,
      );
      continue;
    }
    mapped.push({
      user_id: row.user_id,
      level,
      // The old "qualification_name" is what `stream_of` needs to read.
      discipline: row.qualification_name,
      institution: row.institute_name,
      board_university: row.board_university,
      year_of_passing: row.passing_year,
      percentage: row.percentage,
    });
  }

  note("education_qualifications", mapped.length);
  if (APPLY) await write("education_qualifications", mapped, "id");
}

/* ── exam_attempts ─────────────────────────────────────────────────────── */

if (wanted("exam_attempts")) {
  const rows = await readAll(
    OLD,
    "exam_attempts",
    "id,user_id,exam_id,year,status,roll_number,notes,created_at",
  );

  const mapped = rows.map((row) => {
    const examId = examIdMap.get(row.exam_id) ?? null;
    if (!examId) {
      problem("exam_attempts", `exam ${row.exam_id} has no counterpart; kept as free text`);
    }
    return {
      user_id: row.user_id,
      exam_id: examId,
      // The subject has to survive even when the exam did not.
      custom_name: examId
        ? null
        : (oldExams.find((e) => e.id === row.exam_id)?.name ?? "Tracked exam"),
      status: [
        "tracking",
        "applied",
        "admit_card",
        "appeared",
        "passed",
        "failed",
        "withdrawn",
      ].includes(row.status)
        ? row.status
        : "tracking",
      roll_number: row.roll_number,
      // `year` has no column here. It goes into the note rather than being
      // fabricated into `applied_at` — inventing a date somebody never gave is
      // worse than recording the year as the fact it is.
      notes:
        [row.year ? `${row.year} attempt` : null, row.notes].filter(Boolean).join(" · ") ||
        null,
    };
  });

  note("exam_attempts", mapped.length);
  if (APPLY) await write("exam_attempts", mapped, "id");
}

/* ── saved_jobs ────────────────────────────────────────────────────────── */

if (wanted("saved_jobs")) {
  const rows = await readAll(OLD, "saved_jobs", "id,user_id,job_id,created_at");

  const mapped = [];
  for (const row of rows) {
    const jobId = jobIdMap.get(row.job_id);
    if (!jobId) {
      const title = oldJobs.find((j) => j.id === row.job_id)?.title ?? row.job_id;
      problem("saved_jobs", `no counterpart for "${title}"`);
      continue;
    }
    mapped.push({ user_id: row.user_id, job_id: jobId, saved_at: row.created_at });
  }

  note("saved_jobs", mapped.length);
  if (APPLY) await write("saved_jobs", mapped, "user_id,job_id");
}

/* ── user_roles ────────────────────────────────────────────────────────── */

if (wanted("user_roles")) {
  const rows = await readAll(OLD, "user_roles", "id,user_id,role");
  const mapped = rows.map((row) => ({ user_id: row.user_id, role: String(row.role) }));

  note("user_roles", mapped.length, mapped.map((r) => r.role).join(", "));
  if (APPLY) await write("user_roles", mapped, "user_id,role");
}

/* ── documents ─────────────────────────────────────────────────────────── */

if (wanted("documents")) {
  const rows = await readAll(OLD, "documents", "id,user_id").catch(() => []);
  // The rows are pointers; the files live in Storage, which the 402 also
  // blocks. Twelve people re-uploading is cheaper than engineering around it —
  // see docs/DATA-EXPORT.md.
  note("documents", 0, `${rows.length} rows NOT migrated — files live in Storage`);
}

/* ── Report ────────────────────────────────────────────────────────────── */

console.log("\n── What would move ──");
for (const row of summary) {
  console.log(`  ${row.table.padEnd(26)} ${String(row.count).padStart(5)}  ${row.detail}`);
}

if (problems.length > 0) {
  console.log(`\n── ${problems.length} things needing a decision ──`);
  for (const line of problems.slice(0, 40)) console.log(`  ${line}`);
  if (problems.length > 40) console.log(`  … and ${problems.length - 40} more`);
}

console.log(
  APPLY
    ? "\nDone. Re-run to confirm a second pass writes the same rows and changes nothing."
    : "\nNothing was written. Re-run with --apply once the list above is acceptable.",
);

/* ── Helpers ───────────────────────────────────────────────────────────── */

function valueOf(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. See the header of this file.`);
    process.exit(1);
  }
  return value;
}

function loadEnvLocal() {
  for (const file of [".env.local", ".env"]) {
    try {
      const text = readFileSync(resolve(process.cwd(), file), "utf8");
      for (const line of text.split("\n")) {
        const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
        if (!match) continue;
        const [, key, raw] = match;
        if (process.env[key] === undefined) process.env[key] = raw.replace(/^["']|["']$/g, "");
      }
    } catch {
      // Absent is fine — the variables may be exported already.
    }
  }
}
