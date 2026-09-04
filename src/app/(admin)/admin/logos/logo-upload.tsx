"use client";

import { useActionState, useId, useState } from "react";

import { SubmitButton } from "@/components/ui/submit-button";
import { uploadLogoAction } from "@/lib/admin/actions";
import { Result } from "../action-form";

/**
 * The logo picker, which converts before it uploads.
 *
 * The `logos` bucket accepts `image/webp` and nothing else, and that is a
 * security decision rather than a size one: the bucket is *public*, and an SVG
 * is a document — it can carry `<script>`, which a public bucket will serve
 * with an image content type to anyone who opens the object URL directly. The
 * old project's bucket held four of them.
 *
 * So something has to rasterise, and the choice was an image library inside a
 * serverless function or a canvas in the browser. The canvas wins on every
 * axis that matters here: no dependency, no cold-start cost, no function
 * timeout, and the bytes that cross the network are the 128 px WebP rather than
 * the 778 kB government seal it came from. A dozen kilobytes instead of most of
 * a megabyte, on a plan that meters both.
 *
 * The server re-checks the type and the size anyway (`uploadLogoAction`),
 * because the thing doing the conversion is the thing being trusted about it.
 */

/** What the badge renders at, doubled for high-density screens. */
const SIZE = 128;

export function LogoUpload({
  orgId,
  slug,
  name,
}: {
  orgId: string;
  slug: string;
  name: string;
}) {
  const [state, formAction] = useActionState(uploadLogoAction, null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputId = useId();

  async function handlePick(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const picked = input.files?.[0];
    if (!picked) return;

    setError(null);
    setBusy(true);

    try {
      const webp = await toWebp(picked, `${slug}.webp`);

      // The converted file replaces the picked one on the input itself, so the
      // form submits normally — no interception, no hidden field, and the
      // control still says which file is attached.
      const transfer = new DataTransfer();
      transfer.items.add(webp);
      input.files = transfer.files;

      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(webp);
      });
    } catch (cause) {
      // Clearing the input matters: leaving the unconverted original attached
      // would let a submit send a PNG the bucket will reject, and the failure
      // would read as a server problem rather than as this one.
      input.value = "";
      setError(cause instanceof Error ? cause.message : "Could not read that image.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="orgId" value={orgId} />
      <input type="hidden" name="slug" value={slug} />

      {preview ? (
        /* A blob: URL that exists for a few seconds in an admin tool. The
           image loader has nothing to optimise here and could not fetch it
           anyway — blob: is not a URL a server-side loader can resolve. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt=""
          width={32}
          height={32}
          className="size-8 shrink-0 rounded border border-line bg-surface-2 object-contain"
        />
      ) : null}

      <input
        id={inputId}
        type="file"
        name="logo"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        onChange={(event) => void handlePick(event)}
        aria-label={`Logo for ${name}`}
        className="max-w-52 text-2xs text-ink-3 file:mr-2 file:rounded-md file:border file:border-line file:bg-surface file:px-2 file:py-1 file:text-2xs file:font-medium file:text-ink hover:file:bg-surface-2"
      />

      <SubmitButton size="sm" pendingLabel="Uploading…" disabled={busy || !preview}>
        {busy ? "Converting…" : "Upload"}
      </SubmitButton>

      {error ? (
        <span aria-live="polite" className="text-2xs text-critical">
          {error}
        </span>
      ) : (
        <Result state={state} />
      )}
    </form>
  );
}

/**
 * Any image the browser can decode → a 128 px WebP with its aspect ratio kept.
 *
 * Contain rather than cover, and a transparent ground: these are emblems, and
 * cropping one to fill a square cuts the crest off. A wordmark that is four
 * times as wide as it is tall ends up letterboxed, which is correct — the badge
 * that renders it centres on a neutral background too.
 */
async function toWebp(file: File, name: string): Promise<File> {
  const url = URL.createObjectURL(file);

  try {
    const image = await load(url);

    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE;

    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser has no 2D canvas.");

    // An SVG with no intrinsic size decodes to 0×0 in some browsers, which
    // would otherwise produce a blank file rather than an error.
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (width === 0 || height === 0) {
      throw new Error("That image has no size — try a PNG.");
    }

    const scale = Math.min(SIZE / width, SIZE / height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;

    context.imageSmoothingQuality = "high";
    context.drawImage(
      image,
      (SIZE - drawWidth) / 2,
      (SIZE - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );

    const blob = await new Promise<Blob | null>((resolve) => {
      // 0.92 rather than 1.0: lossless WebP of a photographic seal runs several
      // times larger for a difference nobody can see at 32 px.
      canvas.toBlob(resolve, "image/webp", 0.92);
    });

    if (!blob) throw new Error("This browser cannot write WebP.");
    if (blob.size > 262_144) throw new Error("Still over 256 kB after conversion.");

    return new File([blob], name, { type: "image/webp" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      resolve(image);
    };
    image.onerror = () => {
      reject(new Error("Could not decode that file as an image."));
    };
    image.src = url;
  });
}
