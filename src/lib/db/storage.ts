/**
 * Storage paths → URLs.
 *
 * The database stores a path — `organizations/staff-selection-commission.webp`
 * — and never a URL, so the CDN origin can move without a data migration
 * touching 3,744 rows. This is the one place that knows what an origin is.
 *
 * No `server-only` guard: a logo URL is built in the browser by the component
 * that renders it, and the origin below is the public half.
 */

/**
 * The CDN origin, read as a literal rather than through `@/lib/env`.
 *
 * This is the one line in this file with a bundle cost behind it. `logoUrl` is
 * called from `OrganizationLogo`, which is a Client Component, so everything
 * this module imports ships to the browser — and importing `env` imported Zod,
 * which is 65 kB gzipped and arrived on every route that draws a job card:
 * `/`, `/jobs`, `/updates`, `/saved`, `/for-you`, `/tracker` and both detail
 * routes. That is a 40% increase over the framework floor, to validate one
 * string, in the process least able to do anything about a bad one.
 *
 * A literal `process.env.NEXT_PUBLIC_*` property access is what the bundler
 * replaces with the value at build time — see the note at the top of
 * `@/lib/env` — so this costs nothing and reads the same value. The validation
 * has not moved: `env.ts` still parses this key at import, and every server
 * entry point imports it, so a build with a missing or malformed public
 * environment fails there long before this module is reached.
 */
const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

/**
 * Asserted rather than defaulted, and that is the point of writing it out.
 *
 * `?? ""` would type-check and then build `undefined/storage/v1/...` into every
 * `<img src>` on the page — a broken logo on 3,744 cards and nothing anywhere
 * saying why. This turns the same misconfiguration into one named error, which
 * is the posture `@/lib/env` takes for the identical key. It cannot fire in a
 * correctly built deployment: the value is inlined at build time, and the build
 * itself fails in `env.ts` first if it is absent.
 */
if (!configuredUrl) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set — logo URLs cannot be built.");
}

/**
 * Rebound after the guard so the type is `string` rather than `string | undefined`.
 * Narrowing a module-scope `const` does not reach into a function declared below
 * it, so `logoUrl` would otherwise interpolate a possibly-undefined value — which
 * is the lint error that made this guard necessary rather than optional.
 */
const SUPABASE_URL: string = configuredUrl;

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
  return `${SUPABASE_URL}/storage/v1/object/public/logos/${path}`;
}
