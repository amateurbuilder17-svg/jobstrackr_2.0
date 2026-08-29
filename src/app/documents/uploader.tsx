"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { UploadIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { DOCUMENT_TYPES } from "@/lib/ai/prompts/ocr";
import { createUploadSlotAction, registerDocumentAction } from "@/lib/documents/upload-actions";

/**
 * Pick a document type, choose a file, upload it.
 *
 * The bytes go browser → storage, never through the Vercel function. A 20 MB
 * photograph posted through a Server Action would spend the function's memory
 * and its request-size limit to arrive somewhere it then has to be forwarded
 * from anyway.
 *
 * It does that with a signed URL the server issues, not with a Supabase client
 * of its own. The client was the first attempt and it cost 124 kB — /documents
 * came out at 285 kB against a 161 kB budget. A plain `fetch` PUT to a
 * server-issued URL costs nothing and is safer: the *server* builds the path
 * from the session, so this component never names where the file goes and
 * cannot attempt somebody else's folder even in principle.
 */

/** Matches the bucket's own ceiling, so the failure happens before the upload. */
const MAX_BYTES = 20 * 1024 * 1024;

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,application/pdf";

export function Uploader() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<string>(DOCUMENT_TYPES[0].value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);

    if (file.size > MAX_BYTES) {
      setError("That file is over 20 MB. A photo from a phone camera is usually fine.");
      return;
    }

    setBusy(true);
    try {
      const slot = await createUploadSlotAction({
        kind,
        mimeType: file.type,
        sizeBytes: file.size,
      });
      if (!slot.ok) {
        setError(slot.message);
        return;
      }

      const response = await fetch(slot.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });

      if (!response.ok) {
        setError("Could not upload that. Check your connection and try again.");
        return;
      }

      // The row is written by a Server Action, not from here. A client-written
      // row could claim any path, any size and any owner; this one is checked
      // against the object that was actually created.
      const result = await registerDocumentAction({
        kind,
        storagePath: slot.path,
        mimeType: file.type,
        sizeBytes: file.size,
      });

      if (!result.ok) {
        setError(result.message);
        return;
      }

      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 rounded-md border border-line bg-surface p-4">
      <fieldset>
        <legend className="text-sm font-medium text-ink">What is it?</legend>
        <p className="mt-1 text-xs text-ink-3">
          Telling us this is what makes the reading accurate — each type is read differently.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {DOCUMENT_TYPES.map((type) => (
            <label
              key={type.value}
              className={
                "cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium " +
                "transition-colors duration-(--duration-fast) " +
                (kind === type.value
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line bg-surface text-ink-2 hover:border-line-strong") +
                " has-focus-visible:ring-2 has-focus-visible:ring-accent/25"
              }
            >
              <input
                type="radio"
                name="kind"
                value={type.value}
                checked={kind === type.value}
                onChange={() => {
                  setKind(type.value);
                }}
                className="sr-only"
              />
              {type.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
          className="sr-only"
          id="document-file"
        />
        <Button variant="primary" disabled={busy} onClick={() => fileRef.current?.click()}>
          <UploadIcon className="size-4" />
          {busy ? "Uploading…" : "Choose a file"}
        </Button>
        <span className="text-xs text-ink-3">JPG, PNG, WebP, HEIC or PDF · up to 20 MB</span>
      </div>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-critical">
          {error}
        </p>
      ) : null}
    </div>
  );
}
