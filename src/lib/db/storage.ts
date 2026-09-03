import { env } from "@/lib/env";

/**
 * Storage paths → URLs.
 *
 * The database stores a path — `organizations/staff-selection-commission.webp`
 * — and never a URL, so the CDN origin can move without a data migration
 * touching 3,744 rows. This is the one place that knows what an origin is.
 *
 * No `server-only` guard: a logo URL is built in the browser by the component
 * that renders it, and `env` here is the public half.
 */

/**
 * A public URL for an object in the `logos` bucket.
 *
 * The bucket is public, so this needs no signing round-trip and the result is
 * cacheable by the CDN forever — the objects are uploaded immutable, at the
 * size they are displayed. Deliberately *not* Supabase's `/render/image/`
 * transform endpoint, which the old app used to shrink a 778 kB seal down to a
 * 36 px badge on every request: the import already did that once, offline.
 */
export function logoUrl(path: string): string {
  return `${env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/logos/${path}`;
}
