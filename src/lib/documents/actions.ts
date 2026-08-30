"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { readDocument } from "@/lib/ai/ocr";
import { hasApiKeys } from "@/lib/ai/gemini";
import { getUser } from "@/lib/auth/session";
import { sessionDb } from "@/lib/db/clients";
import { PII_COLUMNS } from "@/lib/profile/pii";
import { consume, LIMITS } from "@/lib/rate-limit";
import { FIELD_MAP, toSuggestions, type Suggestion } from "./fields";

/**
 * Upload, read, review, accept.
 *
 * The security rules this file exists to enforce, all four of them inherited
 * from the old project's edge function and all four now backed by the database
 * rather than by this code remembering:
 *
 *   1. **The storage path carries the owner.** Objects are written to
 *      `<user-id>/<uuid>`, and the storage policies in migration 0030 refuse
 *      anything else. The old function checked the first path segment in
 *      JavaScript; that check held for exactly as long as every future caller
 *      remembered to write it.
 *   2. **A document id is not a capability.** Every read here goes through
 *      `sessionDb` under RLS, so passing somebody else's id returns nothing —
 *      there is no branch to forget.
 *   3. **Nothing is written to a profile without being accepted.** OCR writes
 *      to `documents.ocr_result` and stops. The review screen shows each field
 *      with what it would replace; `acceptFieldsAction` writes only the keys
 *      the owner ticked.
 *   4. **Model calls are quota'd in Postgres.** `claim_ai_quota` with kind
 *      `ocr`, shared across instances, because the in-process bucket is
 *      per-instance by its own admission and this call costs money.
 */

const DAILY_LIMIT = 7; // The old function's limit, unchanged.
const COOLDOWN_SECONDS = 20;

export type ActionResult = { ok: true; message?: string } | { ok: false; message: string };

/* ── Run OCR over an uploaded document ───────────────────────────────────── */

export async function runOcrAction(documentId: string): Promise<ActionResult> {
  const parsed = z.uuid().safeParse(documentId);
  if (!parsed.success) return { ok: false, message: "That document does not exist." };

  const user = await getUser();
  if (!user) return { ok: false, message: "Sign in first." };

  if (!consume(`ocr:${user.id}`, LIMITS.ai)) {
    return { ok: false, message: "One at a time — try again in a few seconds." };
  }

  const db = await sessionDb();

  // Under RLS: somebody else's id simply returns nothing. The IDOR check the
  // old function performed by hand is the `where` clause the policy adds.
  const { data: doc } = await db
    .from("documents")
    .select("id, kind, storage_path, mime_type, ocr_status")
    .eq("id", parsed.data)
    .maybeSingle();

  if (!doc) return { ok: false, message: "That document does not exist." };
  if (doc.ocr_status === "processing") {
    return { ok: false, message: "Already reading this one." };
  }

  if (!(await hasApiKeys())) {
    return { ok: false, message: "Document reading is not configured on this deployment." };
  }

  const { data: quota, error: quotaError } = await db.rpc("claim_ai_quota", {
    p_kind: "ocr",
    p_daily_limit: DAILY_LIMIT,
    p_cooldown_seconds: COOLDOWN_SECONDS,
  });

  if (quotaError) return { ok: false, message: "Could not read that just now." };

  const claim = quota[0];
  if (!claim?.allowed) {
    const wait = claim?.retry_after ?? COOLDOWN_SECONDS;
    return {
      ok: false,
      message:
        wait <= 120
          ? `Just a moment — try again in ${String(wait)}s.`
          : `That is all ${String(DAILY_LIMIT)} documents for today.`,
    };
  }

  await db
    .from("documents")
    .update({ ocr_status: "processing", ocr_error: null })
    .eq("id", doc.id);

  // Downloaded through the session client, so the storage policy is what
  // authorises it — not a service key plus a path check.
  const { data: file, error: downloadError } = await db.storage
    .from("documents")
    .download(doc.storage_path);

  if (downloadError) {
    await fail(doc.id, "Could not open that file.");
    return { ok: false, message: "Could not open that file." };
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  let result;
  try {
    result = await readDocument({
      documentType: doc.kind,
      mimeType: doc.mime_type ?? "image/jpeg",
      data: base64,
    });
  } catch {
    await fail(doc.id, "The reader was unavailable. Try again shortly.");
    return { ok: false, message: "The reader was unavailable. Try again shortly." };
  }

  if (!result) {
    await fail(doc.id, "Could not read anything from that image.");
    return {
      ok: false,
      message: "Could not read anything from that image. A sharper photo usually fixes it.",
    };
  }

  await db
    .from("documents")
    .update({
      ocr_status: "done",
      ocr_result: result.raw as never,
      ocr_error: null,
      ocr_attempts: 0,
      reviewed_at: null,
    })
    .eq("id", doc.id);

  revalidatePath("/documents");
  return { ok: true, message: "Read it. Check what we found before it is saved." };
}

async function fail(id: string, message: string): Promise<void> {
  const db = await sessionDb();
  // Never left in `processing`: a row stuck there shows a spinner forever and
  // refuses a retry, which is the worst of both.
  await db.from("documents").update({ ocr_status: "failed", ocr_error: message }).eq("id", id);
}

/* ── What the review screen shows ────────────────────────────────────────── */

export async function getSuggestionsAction(documentId: string): Promise<Suggestion[]> {
  const user = await getUser();
  if (!user) return [];

  const db = await sessionDb();

  const [{ data: doc }, { data: profile }] = await Promise.all([
    db.from("documents").select("ocr_result").eq("id", documentId).maybeSingle(),
    db.from("profiles").select(PII_COLUMNS).eq("id", user.id).maybeSingle(),
  ]);

  if (!doc?.ocr_result) return [];

  return toSuggestions(doc.ocr_result, profile ?? {});
}

/* ── Accept some of it ───────────────────────────────────────────────────── */

export async function acceptFieldsAction(
  documentId: string,
  keys: string[],
): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return { ok: false, message: "Sign in first." };
  if (!consume(`accept:${user.id}`, LIMITS.form)) {
    return { ok: false, message: "Too many changes at once." };
  }

  // Re-derived here rather than trusted from the client. The browser sends
  // which keys were ticked; the *values* come from the stored OCR result, so a
  // tampered request can at most accept a field the model really did return.
  const suggestions = await getSuggestionsAction(documentId);
  const chosen = suggestions.filter((s) => keys.includes(s.key));
  if (chosen.length === 0) return { ok: false, message: "Nothing selected." };

  const db = await sessionDb();

  const profilePatch: Record<string, string | number> = {};
  for (const s of chosen) {
    if (!s.education && FIELD_MAP[s.key]) profilePatch[s.column] = s.value;
  }

  if (Object.keys(profilePatch).length > 0) {
    // The cast is at the boundary of a whitelist, not around one. Supabase
    // types `update()` against the concrete row, and this object is built key
    // by key from `FIELD_MAP` — a column name that is not in that map cannot
    // reach here, which is the property that actually matters. Typing it as
    // the row instead would mean either listing all 40 columns as optional or
    // giving up the whitelist, and the whitelist is the security.
    const patch = profilePatch as never;
    const { error } = await db.from("profiles").update(patch).eq("id", user.id);
    if (error) return { ok: false, message: "Could not save those." };
  }

  // Education is deliberately not written here. A marksheet names one
  // qualification and the table is keyed `(user_id, level)`, so writing it
  // blind either overwrites an existing row or fails on the unique constraint.
  // The review screen sends the reader to the profile's education section with
  // the values in hand instead — a smaller feature that cannot silently
  // replace a degree.
  const educationCount = chosen.filter((s) => s.education).length;

  await db
    .from("documents")
    .update({ reviewed_at: new Date().toISOString() })
    .eq("id", documentId);

  revalidatePath("/documents");
  revalidatePath("/my-details");
  revalidatePath("/profile");

  const saved = Object.keys(profilePatch).length;
  return {
    ok: true,
    message:
      educationCount > 0
        ? `Saved ${String(saved)} to your profile. Education fields need adding by hand — the values are above.`
        : `Saved ${String(saved)} to your profile.`,
  };
}

/* ── Delete ──────────────────────────────────────────────────────────────── */

export async function deleteDocumentAction(documentId: string): Promise<ActionResult> {
  const user = await getUser();
  if (!user) return { ok: false, message: "Sign in first." };

  const db = await sessionDb();

  const { data: doc } = await db
    .from("documents")
    .select("id, storage_path")
    .eq("id", documentId)
    .maybeSingle();

  if (!doc) return { ok: false, message: "That document does not exist." };

  // The object first, then the row. The other order can leave an object with
  // nothing pointing at it — invisible in the app and still sitting in storage,
  // which for a photograph of an Aadhaar card is the wrong way round to fail.
  await db.storage.from("documents").remove([doc.storage_path]);
  await db.from("documents").delete().eq("id", doc.id);

  revalidatePath("/documents");
  return { ok: true, message: "Deleted." };
}
