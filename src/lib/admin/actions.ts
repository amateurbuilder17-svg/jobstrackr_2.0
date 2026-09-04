"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { z } from "zod";

import { adminOnly } from "@/lib/db/queries/admin";
import { tags } from "@/lib/db/tags";

/**
 * Admin mutations.
 *
 * Two rules, and neither is optional.
 *
 * **Every action re-checks the role.** `adminOnly` is not a convenience for
 * getting a client — it is the authorisation boundary, and a Server Action is
 * a public HTTP endpoint whose id is discoverable in the page's own JavaScript.
 * The layout's `notFound()` guards *rendering*; it does nothing for a POST.
 * An action that skipped the check would be an unauthenticated write endpoint
 * against a client that ignores RLS.
 *
 * **Every write that changes public content invalidates its tag.** Pages here
 * live on the CDN until a tag says otherwise, so a fix applied in the admin and
 * not revalidated is a fix nobody outside this page will see. That is worse
 * than not applying it, because the admin's own table will show it as done.
 */

export interface ActionResult {
  ok: boolean;
  /** Shown back to the operator. Always says what actually happened. */
  message: string;
}

/**
 * `null` before anything has been submitted, so a fresh form renders no banner.
 *
 * Every action below takes the previous state as its first argument even when
 * it ignores it, because that is the signature `useActionState` calls with.
 * Uniformity here means the client wrapper is one component rather than two.
 */
export type AdminFormState = ActionResult | null;

/* ── Jobs · vacancies ──────────────────────────────────────────────────── */

const vacancyFix = z.object({
  jobId: z.uuid(),
  // The upper bound is a typo guard, not a policy: the largest real Indian
  // recruitment drive is around 150,000 posts, and a stray keystroke in this
  // box would otherwise write a number that renders as fact on a public page.
  vacancies: z.coerce.number().int().min(1).max(1_000_000),
});

/**
 * Writes the title-derived vacancy count onto the rows an admin ticked.
 *
 * Selected rows arrive as repeated `fix` fields rather than as one JSON blob,
 * so the form works without JavaScript and each row is validated on its own —
 * one bad value skips its row instead of rejecting the batch.
 */
export async function applyVacancyFixesAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<ActionResult> {
  const db = await adminOnly("applyVacancyFixesAction");

  const fixes = formData.getAll("fix").flatMap((raw) => {
    if (typeof raw !== "string") return [];
    const [jobId, vacancies] = raw.split(":");
    const parsed = vacancyFix.safeParse({ jobId, vacancies });
    return parsed.success ? [parsed.data] : [];
  });

  if (fixes.length === 0) return { ok: false, message: "Nothing selected." };

  let updated = 0;
  for (const fix of fixes) {
    const { error } = await db
      .from("jobs")
      .update({
        vacancies: fix.vacancies,
        // Cleared, not rewritten. `vacancies_display` exists to carry text the
        // number cannot ("Various", "1,500+"), and stamping the parsed integer
        // into it would replace a truer string with a less true one.
        vacancies_display: null,
      })
      .eq("id", fix.jobId);
    if (!error) updated++;
  }

  revalidateTag(tags.jobList(), { expire: 0 });
  revalidatePath("/admin/jobs/vacancies");

  return {
    ok: updated > 0,
    message:
      updated === fixes.length
        ? `Updated ${String(updated)} listing${updated === 1 ? "" : "s"}.`
        : `Updated ${String(updated)} of ${String(fixes.length)}; the rest failed.`,
  };
}

/* ── Jobs · duplicates ─────────────────────────────────────────────────── */

/**
 * Collapses every duplicate group in one call.
 *
 * Deliberately not a per-row delete button. A duplicate row can be somebody's
 * saved job, tracked exam or calendar reminder, and `on delete cascade` would
 * take all three with it — silently unsaving something a person put there.
 * `merge_duplicate_jobs()` reassigns every referencing table to the surviving
 * row first, which is the whole reason it exists; a delete button beside it
 * would be the same operation minus the part that protects users.
 *
 * It is idempotent, so pressing it twice is not a hazard.
 */
export async function mergeDuplicatesAction(
  _prev: AdminFormState,
  _formData: FormData,
): Promise<ActionResult> {
  const db = await adminOnly("mergeDuplicatesAction");

  const { data, error } = await db.rpc("merge_duplicate_jobs");
  if (error) return { ok: false, message: `Merge failed: ${error.message}` };

  const merged = data;
  revalidateTag(tags.jobList(), { expire: 0 });
  revalidatePath("/admin/jobs/duplicates");

  return {
    ok: true,
    message:
      merged === 0
        ? "Nothing to merge — no duplicate groups left."
        : `Merged ${String(merged)} duplicate listing${merged === 1 ? "" : "s"} into their survivors.`,
  };
}

/* ── Jobs · closing dates ──────────────────────────────────────────────── */

const dateFix = z.object({
  jobId: z.uuid(),
  date: z.iso.date(),
});

/**
 * Fills in a missing `last_date` from what the notification printed.
 *
 * The date is taken from the form field, not re-derived here, because the
 * operator may have corrected the parser's suggestion — which is the point of
 * showing it in an editable box rather than applying it automatically.
 */
export async function applyLastDatesAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<ActionResult> {
  const db = await adminOnly("applyLastDatesAction");

  const selected = new Set(
    formData.getAll("selected").filter((v): v is string => typeof v === "string"),
  );

  const fixes = [...selected].flatMap((jobId) => {
    const parsed = dateFix.safeParse({ jobId, date: formData.get(`date:${jobId}`) });
    return parsed.success ? [parsed.data] : [];
  });

  if (fixes.length === 0) return { ok: false, message: "Nothing selected, or no valid date." };

  let updated = 0;
  for (const fix of fixes) {
    const { error } = await db
      .from("jobs")
      // The display string goes with it: it exists to say "no real date here",
      // and leaving it in place would print the old free text over the new date.
      .update({ last_date: fix.date, last_date_display: null })
      .eq("id", fix.jobId);
    if (!error) updated++;
  }

  revalidateTag(tags.jobList(), { expire: 0 });
  revalidatePath("/admin/jobs/dates");

  return {
    ok: updated > 0,
    message: `Filled in ${String(updated)} closing date${updated === 1 ? "" : "s"}.`,
  };
}

/* ── Jobs · status ─────────────────────────────────────────────────────── */

/**
 * Closes every listing whose deadline has passed.
 *
 * Runs nightly from `/api/cron/prune` already; the button is for the morning
 * after a feed lands a batch of stale rows and nobody wants to wait for
 * midnight.
 */
export async function closeExpiredJobsAction(
  _prev: AdminFormState,
  _formData: FormData,
): Promise<ActionResult> {
  const db = await adminOnly("closeExpiredJobsAction");

  const { data, error } = await db.rpc("close_expired_jobs");
  if (error) return { ok: false, message: `Failed: ${error.message}` };

  const closed = data;
  revalidateTag(tags.jobList(), { expire: 0 });
  revalidatePath("/admin/jobs");

  return {
    ok: true,
    message:
      closed === 0
        ? "Nothing expired."
        : `Closed ${String(closed)} expired listing${closed === 1 ? "" : "s"}.`,
  };
}

/**
 * Re-runs the update → job resolver over unresolved rows.
 *
 * The counts it returns are the point: `ambiguous` is the pile a human has to
 * decide, and it is the only one that does not shrink on its own.
 */
export async function resolveUpdateLinksAction(
  _prev: AdminFormState,
  _formData: FormData,
): Promise<ActionResult> {
  const db = await adminOnly("resolveUpdateLinksAction");

  const { data, error } = await db.rpc("resolve_update_job_links", { p_batch: 500 });
  if (error) return { ok: false, message: `Failed: ${error.message}` };

  const row = data[0];
  revalidateTag(tags.examUpdateList(), { expire: 0 });
  revalidatePath("/admin/updates");

  return {
    ok: true,
    message: row
      ? `Linked ${String(row.linked)}, ${String(row.ambiguous)} ambiguous, ${String(row.no_match)} with no match.`
      : "Nothing left to resolve.",
  };
}

/* ── Logos ─────────────────────────────────────────────────────────────── */

const logoUpload = z.object({
  orgId: z.uuid(),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Not a slug."),
});

/**
 * Stores one organisation's logo and points the row at it.
 *
 * The file arrives already converted to a 128 px WebP — the browser does it on
 * a canvas before submitting (see `logo-upload.tsx`). That is not a
 * micro-optimisation: the bucket accepts `image/webp` only, and it accepts it
 * only from the secret key, so the alternatives were an image-processing
 * dependency inside a serverless function or an SVG upload path. An SVG is a
 * document — it can carry `<script>`, which a *public* bucket will serve with
 * an image content type to anyone who opens the object URL — so rasterising
 * before the bytes ever reach storage is the security boundary, not a
 * convenience.
 *
 * The size ceiling here is a second gate behind the bucket's own 256 kB limit,
 * because the client that produced the file is the thing being trusted about it.
 */
export async function uploadLogoAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<ActionResult> {
  const db = await adminOnly("uploadLogoAction");

  const parsed = logoUpload.safeParse({
    orgId: formData.get("orgId"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return { ok: false, message: "Bad organisation." };

  const file = formData.get("logo");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "No image." };
  }
  if (file.type !== "image/webp") {
    return { ok: false, message: "Only WebP is accepted; the picker converts for you." };
  }
  if (file.size > 262_144) {
    return { ok: false, message: "Over 256 kB — the picker should have shrunk this." };
  }

  const path = `organizations/${parsed.data.slug}.webp`;

  const { error: uploadError } = await db.storage
    .from("logos")
    // `upsert` so replacing a bad logo does not need a delete first. The path
    // is derived from the slug, so one organisation can only ever own one
    // object and re-uploading cannot orphan the previous file.
    .upload(path, file, { contentType: "image/webp", upsert: true, cacheControl: "31536000" });

  if (uploadError) return { ok: false, message: `Upload failed: ${uploadError.message}` };

  const { error } = await db
    .from("organizations")
    .update({ logo_path: path })
    .eq("id", parsed.data.orgId);

  if (error)
    return { ok: false, message: `Stored, but the row did not update: ${error.message}` };

  // Every job card for this body renders the badge, so the whole list is stale,
  // not just the organisation's own page.
  revalidateTag(tags.organization(parsed.data.slug), { expire: 0 });
  revalidateTag(tags.jobList(), { expire: 0 });
  revalidatePath("/admin/logos");

  return { ok: true, message: "Logo uploaded." };
}

export async function removeLogoAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<ActionResult> {
  const db = await adminOnly("removeLogoAction");

  const parsed = logoUpload.safeParse({
    orgId: formData.get("orgId"),
    slug: formData.get("slug"),
  });
  if (!parsed.success) return { ok: false, message: "Bad organisation." };

  // The row first. If the object were deleted first and this failed, the column
  // would point at a 404 and every card for this body would render a broken
  // image; this way the worst case is an orphaned file nobody reads.
  const { error } = await db
    .from("organizations")
    .update({ logo_path: null })
    .eq("id", parsed.data.orgId);

  if (error) return { ok: false, message: `Failed: ${error.message}` };

  await db.storage.from("logos").remove([`organizations/${parsed.data.slug}.webp`]);

  revalidateTag(tags.organization(parsed.data.slug), { expire: 0 });
  revalidateTag(tags.jobList(), { expire: 0 });
  revalidatePath("/admin/logos");

  return { ok: true, message: "Logo removed. Cards fall back to initials." };
}

/* ── Ingestion sources ─────────────────────────────────────────────────── */

const sourceInput = z.object({
  name: z.string().trim().min(2).max(120),
  // http/https only. A `javascript:` or `data:` URL in this column would be
  // rendered as a link on this very page.
  url: z.url().refine((u) => /^https?:\/\//i.test(u), "Must be http(s)."),
  category: z.enum([
    "admit_card",
    "result",
    "answer_key",
    "syllabus",
    "notification",
    "exam_date",
    "cutoff",
    "news",
  ]),
  limitPerRun: z.coerce.number().int().min(1).max(500),
});

export async function saveSourceAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<ActionResult> {
  const db = await adminOnly("saveSourceAction");

  const parsed = sourceInput.safeParse({
    name: formData.get("name"),
    url: formData.get("url"),
    category: formData.get("category"),
    limitPerRun: formData.get("limitPerRun"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid source." };
  }

  const id = formData.get("id");
  const row = {
    name: parsed.data.name,
    url: parsed.data.url,
    category: parsed.data.category,
    limit_per_run: parsed.data.limitPerRun,
  };

  const { error } =
    typeof id === "string" && id !== ""
      ? await db.from("scraper_sources").update(row).eq("id", id)
      : await db.from("scraper_sources").insert(row);

  if (error) return { ok: false, message: `Failed: ${error.message}` };

  revalidatePath("/admin/discover");
  return { ok: true, message: id ? "Source updated." : "Source added." };
}

export async function toggleSourceAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<ActionResult> {
  const db = await adminOnly("toggleSourceAction");

  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { ok: false, message: "Bad source." };

  // Paused, never deleted. A source row carries its own history through
  // `last_scraped_at` and through every update attributed to its host; deleting
  // it to stop it would throw that away to achieve what a boolean does.
  const active = formData.get("isActive") === "true";

  const { error } = await db
    .from("scraper_sources")
    .update({ is_active: !active })
    .eq("id", id.data);

  if (error) return { ok: false, message: `Failed: ${error.message}` };

  revalidatePath("/admin/discover");
  return { ok: true, message: active ? "Source paused." : "Source resumed." };
}

/* ── The AI key pool ───────────────────────────────────────────────────── */

const apiKeyInput = z.object({
  provider: z.enum(["gemini", "groq", "openai", "openrouter"]),
  model: z.string().trim().min(2).max(120),
  apiKey: z.string().trim().min(16).max(400),
  label: z.string().trim().max(80).optional(),
  priority: z.coerce.number().int().min(0).max(999),
});

/**
 * Adds a key to the rotation pool.
 *
 * The plaintext goes into `api_keys_config.api_key` and a trigger encrypts it
 * with a Vault-held symmetric key before it lands; nothing after this line can
 * read it back except `decrypted_api_keys_config`, which only the secret key
 * can select from. It is never returned to a browser — see `listApiKeys`.
 */
export async function addApiKeyAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<ActionResult> {
  const db = await adminOnly("addApiKeyAction");

  const parsed = apiKeyInput.safeParse({
    provider: formData.get("provider"),
    model: formData.get("model"),
    apiKey: formData.get("apiKey"),
    // `??` would keep the empty string an unfilled input submits, and an
    // empty label is not a label.
    label: formData.get("label") ?? undefined,
    priority: formData.get("priority"),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Invalid key." };
  }

  const { error } = await db.from("api_keys_config").insert({
    provider: parsed.data.provider,
    model_name: parsed.data.model,
    api_key: parsed.data.apiKey,
    label: parsed.data.label ?? null,
    priority: parsed.data.priority,
  });

  if (error) return { ok: false, message: `Failed: ${error.message}` };

  revalidatePath("/admin/api");
  return { ok: true, message: "Key added to the pool." };
}

export async function toggleApiKeyAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<ActionResult> {
  const db = await adminOnly("toggleApiKeyAction");

  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { ok: false, message: "Bad key." };

  const active = formData.get("isActive") === "true";

  const { error } = await db
    .from("api_keys_config")
    .update({
      is_active: !active,
      // Turning a key back on clears the error that turned it off. Leaving it
      // would show a resolved 429 as the key's status forever, which is how a
      // healthy pool comes to look permanently broken.
      ...(active ? {} : { last_error: null }),
    })
    .eq("id", id.data);

  if (error) return { ok: false, message: `Failed: ${error.message}` };

  revalidatePath("/admin/api");
  return { ok: true, message: active ? "Key disabled." : "Key re-enabled." };
}

export async function deleteApiKeyAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<ActionResult> {
  const db = await adminOnly("deleteApiKeyAction");

  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { ok: false, message: "Bad key." };

  const { error } = await db.from("api_keys_config").delete().eq("id", id.data);
  if (error) return { ok: false, message: `Failed: ${error.message}` };

  revalidatePath("/admin/api");
  return { ok: true, message: "Key removed. Revoke it in the provider's console too." };
}

/* ── Expired listings ──────────────────────────────────────────────────── */

/** At most 500 per call, matching the ceiling inside `admin_delete_expired_jobs`. */
const expiredIds = z.array(z.uuid()).min(1).max(500);

function selectedIds(formData: FormData): string[] {
  return formData.getAll("selected").filter((v): v is string => typeof v === "string");
}

/**
 * Moves expired listings to `archived`.
 *
 * The default action on this page, and the one to reach for. It is reversible,
 * it takes nothing away from anyone — a shortlisted job stays on its owner's
 * list and the detail page still resolves — and it is the honest label for a
 * listing that is being retired from the working set rather than deleted.
 *
 * `archived` rather than `closed`: `closed` means the window shut, which
 * `close_expired_jobs()` has already recorded. This is a second, separate claim
 * — that nobody is going to look at it again.
 */
/**
 * One action, two intents, because one form can only feed one `useActionState`.
 *
 * The obvious shape — two buttons with different `formAction`s — compiles and
 * even works, but the second button's result never reaches the hook the form
 * was created with, so deleting would silently render no message at all. A
 * submit button contributes its own `name`/`value` to the FormData only when it
 * is the button that was pressed, which is exactly the dispatch this needs.
 *
 * An unrecognised intent archives. That is the safe default of the two, and it
 * is the one a hand-crafted POST should land on.
 */
export async function expiredJobsAction(
  prev: AdminFormState,
  formData: FormData,
): Promise<ActionResult> {
  return formData.get("intent") === "delete"
    ? deleteExpiredJobs(prev, formData)
    : archiveExpiredJobs(prev, formData);
}

async function archiveExpiredJobs(
  _prev: AdminFormState,
  formData: FormData,
): Promise<ActionResult> {
  const db = await adminOnly("archiveExpiredJobs");

  const parsed = expiredIds.safeParse(selectedIds(formData));
  if (!parsed.success) return { ok: false, message: "Nothing selected." };

  const { error, count } = await db
    .from("jobs")
    .update({ status: "archived" }, { count: "exact" })
    .in("id", parsed.data)
    // Re-asserted here even though the page only lists expired rows: the form
    // was rendered minutes ago and carries ids chosen from that snapshot. This
    // is what stops a stale (or edited) submission archiving a live listing.
    .lt("last_date", todayInIndia())
    .neq("status", "archived");

  if (error) return { ok: false, message: `Failed: ${error.message}` };

  revalidateTag(tags.jobList(), { expire: 0 });
  revalidatePath("/admin/expired");

  const archived = count ?? 0;
  return {
    ok: true,
    message:
      archived === 0
        ? "Nothing archived — those listings were already archived."
        : `Archived ${String(archived)} listing${archived === 1 ? "" : "s"}.`,
  };
}

/**
 * Deletes expired listings that nobody has saved and nobody has a reminder for.
 *
 * The page only offers this for rows whose counts came back zero, and that is
 * not what makes it safe. The counts were read when the page rendered; somebody
 * can save one of those listings while the tab sits open, and a check performed
 * here would still be deciding on a world that has moved on.
 *
 * What makes it safe is that the predicate lives inside the delete statement in
 * `admin_delete_expired_jobs` — a row that acquired a save in the meantime is
 * skipped, not deleted, and the count returned says how many actually went. So
 * "selected 40, deleted 39" is a legitimate and correctly reported outcome.
 */
async function deleteExpiredJobs(
  _prev: AdminFormState,
  formData: FormData,
): Promise<ActionResult> {
  const db = await adminOnly("deleteExpiredJobs");

  const ids = selectedIds(formData);
  const parsed = expiredIds.safeParse(ids);
  if (!parsed.success) {
    return {
      ok: false,
      message:
        ids.length > 500
          ? "Too many at once — 500 per go, so a mistake stays a small one."
          : "Nothing selected.",
    };
  }

  const { data, error } = await db.rpc("admin_delete_expired_jobs", { p_ids: parsed.data });
  if (error) return { ok: false, message: `Failed: ${error.message}` };

  const deleted = data;
  revalidateTag(tags.jobList(), { expire: 0 });
  revalidateTag(tags.sitemap(), { expire: 0 });
  revalidatePath("/admin/expired");

  if (deleted === parsed.data.length) {
    return {
      ok: true,
      message: `Deleted ${String(deleted)} listing${deleted === 1 ? "" : "s"}.`,
    };
  }

  // Not an error. The skipped rows are ones somebody saved after the page was
  // rendered, and saying so is more useful than a bare count.
  return {
    ok: true,
    message: `Deleted ${String(deleted)} of ${String(parsed.data.length)}. The rest were saved or reminded on since this page loaded, and were kept.`,
  };
}

/** Today in IST, as `YYYY-MM-DD`. Matches `close_expired_jobs`'s comparison. */
function todayInIndia(): string {
  return new Date(Date.now() + 5.5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/* ── Feedback ──────────────────────────────────────────────────────────── */

const feedbackUpdate = z.object({
  id: z.uuid(),
  status: z.enum(["open", "triaged", "resolved", "spam"]),
});

/**
 * Moves one submission along: open → triaged → resolved, or → spam.
 *
 * Through an RPC rather than a table update, because there is no `grant update`
 * on `suggestions_grievances` and adding one would be the wrong shape: anyone
 * on the internet can insert into that table, and the narrowest possible write
 * surface for it is a function that can change the status and nothing else. An
 * admin cannot edit what somebody wrote.
 */
export async function setFeedbackStatusAction(
  _prev: AdminFormState,
  formData: FormData,
): Promise<ActionResult> {
  const db = await adminOnly("setFeedbackStatusAction");

  const parsed = feedbackUpdate.safeParse({
    id: formData.get("id"),
    status: formData.get("status"),
  });
  if (!parsed.success) return { ok: false, message: "Bad submission or status." };

  const { data, error } = await db.rpc("admin_set_feedback_status", {
    p_id: parsed.data.id,
    p_status: parsed.data.status,
  });

  if (error) return { ok: false, message: `Failed: ${error.message}` };
  if (!data) return { ok: false, message: "That submission no longer exists." };

  revalidatePath("/admin/feedback");
  return { ok: true, message: `Marked ${parsed.data.status}.` };
}
