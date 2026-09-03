"use client";

import { useState } from "react";

import { logoUrl } from "@/lib/db/storage";

/**
 * An organisation's emblem, laid over the initials tile that is its fallback.
 *
 * The one reason this is a Client Component: `onError`. A logo that 404s —
 * because an object was deleted, or a path was written by hand — renders as the
 * browser's broken-image glyph, which is worse than the initials it replaced.
 * Unmounting on error uncovers the tile underneath, so the failure mode is the
 * design's own placeholder rather than a torn-paper icon.
 *
 * It is a leaf, and the only thing on a card that crosses into the bundle: a
 * list of twenty jobs ships this component once, not twenty rows of card
 * markup. Everything around it stays a Server Component.
 */
export function OrganizationLogo({ path }: { path: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- see below
    <img
      src={logoUrl(path)}
      alt=""
      // Deliberately not `next/image`. That component exists to resize and
      // re-encode arbitrary remote images at request time, and bills for it;
      // these are already 128 px WebP files on a CDN, sized at import. There is
      // nothing left for it to optimise and a per-image cost to pay for the
      // privilege. `width`/`height` are set here for the same reason it would
      // set them — the box is reserved before the bytes arrive, so a rail of
      // cards does not reflow as logos land.
      width={128}
      height={128}
      loading="lazy"
      decoding="async"
      onError={() => {
        setFailed(true);
      }}
      // `bg-logo-plate`, not `bg-card`. These emblems are drawn in dark ink for
      // white paper, so on a dark card most of them vanish into it — the NTPC
      // mark rendered as an empty tile. The plate is light in both themes, and
      // deliberately not white in dark mode; see the token in globals.css.
      className="absolute inset-0 size-full rounded-xl bg-logo-plate object-contain p-1"
    />
  );
}
