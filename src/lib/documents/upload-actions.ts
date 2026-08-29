"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getUser } from "@/lib/auth/session";
import { sessionDb } from "@/lib/db/clients";
import { consume, LIMITS } from "@/lib/rate-limit";
import { DOCUMENT_TYPES } from "@/lib/ai/prompts/ocr";

/**
 * Record a file the browser has already uploaded.
 *
 * Split from `actions.ts` so the uploader — a Client Component — imports only
 * this. `actions.ts` pulls in the OCR module and through it the Gemini client;
 * a `"use server"` module is not bundled for the browser, but its *imports*
 * still shape what Next has to trace, and keeping the upload path narrow keeps
 * that trace small.
 *
 * The row is written here rather than from the browser because a client-written
 * row could claim any path, any size, and any owner. Every field is checked
 * against the object that actually exists.
 */

const KINDS = DOCUMENT_TYPES.map((d) => d.value) as [string, ...string[]];

const MAX_BYTES = 20 * 1024 * 1024;

/** The MIME types the bucket accepts. Checked here so the failure is a sentence. */
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/pdf",
]);

/** Derived from the MIME type, never from the filename the browser reports. */
const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "application/pdf": "pdf",
};

const slotSchema = z.object({
  kind: z.enum(KINDS),
  mimeType: z.string().max(100),
  sizeBytes: z.number().int().min(1).max(MAX_BYTES),
});

const registerSchema = z.object({
  kind: z.enum(KINDS),
  storagePath: z.string().min(1).max(400),
  mimeType: z.string().max(100),
  sizeBytes: z.number().int().min(0).max(MAX_BYTES),
});

export type SlotResult =
  { ok: true; uploadUrl: string; path: string } | { ok: false; message: string };

/**
 * Issue a one-time URL the browser may PUT a file to.
 *
 * This replaced handing the browser a Supabase client, and the reason was
 * measured: `@supabase/ssr` plus `supabase-js` is ~124 kB of JavaScript, which
 * put /documents at 285 kB against a 161 kB budget — for one upload.
 *
 * It is also the better design. **The server chooses the path.** The browser
 * never names where the file goes, so it cannot attempt somebody else's folder
 * at all, and the storage policy that would have refused it becomes a second
 * line rather than the first. The URL is single-use and short-lived, so it is
 * not a capability worth stealing.
 */
export async function createUploadSlotAction(input: unknown): Promise<SlotResult> {
  const parsed = slotSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That file was not accepted." };

  if (!ALLOWED_MIME.has(parsed.data.mimeType)) {
    return { ok: false, message: "Upload a JPG, PNG, WebP, HEIC or PDF." };
  }

  const user = await getUser();
  if (!user) return { ok: false, message: "Sign in first." };

  if (!consume(`upload:${user.id}`, LIMITS.form)) {
    return { ok: false, message: "Too many uploads at once. Wait a moment." };
  }

  // `<user-id>/<uuid>.<ext>` — built here, from the session, never from input.
  const extension = EXTENSION[parsed.data.mimeType] ?? "bin";
  const path = `${user.id}/${crypto.randomUUID()}.${extension}`;

  const db = await sessionDb();
  const { data, error } = await db.storage.from("documents").createSignedUploadUrl(path);

  if (error) return { ok: false, message: "Could not start that upload." };

  return { ok: true, uploadUrl: data.signedUrl, path: data.path };
}

export type RegisterResult = { ok: true; id: string } | { ok: false; message: string };

export async function registerDocumentAction(input: unknown): Promise<RegisterResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "That upload was not accepted." };

  const user = await getUser();
  if (!user) return { ok: false, message: "Sign in first." };

  if (!consume(`upload:${user.id}`, LIMITS.form)) {
    return { ok: false, message: "Too many uploads at once. Wait a moment." };
  }

  // The path must be inside the caller's own folder. The storage policy already
  // guarantees this for the object itself; checking again here stops a row
  // being written that *points* at somebody else's file — which would be a
  // working IDOR through a table that has no policy problem of its own.
  const [folder] = parsed.data.storagePath.split("/");
  if (folder !== user.id) return { ok: false, message: "That upload was not accepted." };

  const db = await sessionDb();

  // The object has to exist. Without this, a caller could register rows for
  // paths that were never uploaded and queue OCR runs against nothing —
  // spending the daily quota on failures.
  const { data: listed } = await db.storage
    .from("documents")
    .list(user.id, { search: parsed.data.storagePath.split("/").slice(1).join("/") });

  if (!listed || listed.length === 0) {
    return { ok: false, message: "That file did not finish uploading. Try again." };
  }

  const { data, error } = await db
    .from("documents")
    .insert({
      user_id: user.id,
      kind: parsed.data.kind,
      storage_path: parsed.data.storagePath,
      mime_type: parsed.data.mimeType,
      size_bytes: parsed.data.sizeBytes,
      ocr_status: "pending",
    })
    .select("id")
    .single();

  if (error) {
    // The object is already uploaded and now has no row pointing at it. Removed
    // rather than left: an orphaned photograph of an Aadhaar card is invisible
    // in the app and still sitting in the bucket.
    await db.storage.from("documents").remove([parsed.data.storagePath]);
    return { ok: false, message: "Could not save that. Try again." };
  }

  revalidatePath("/documents");
  return { ok: true, id: data.id };
}
