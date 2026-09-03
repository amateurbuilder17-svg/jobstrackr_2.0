-- ═══════════════════════════════════════════════════════════════════════════
-- 0033 · Organisation logos bucket
-- ═══════════════════════════════════════════════════════════════════════════
-- `organizations.logo_path` has existed since 0003 and has been null on all
-- 3,744 rows, because nothing ever created a bucket for it to point into. The
-- old project had one — `logos/conducting-bodies/`, 168 files — and resolved it
-- to an organisation in the browser with a 13 kB lookup hook, on every render,
-- for a 36 px badge.
--
-- This is the bucket the same images land in here. The resolution happens once,
-- offline, in `scripts/import-legacy-logos.mjs`, and its answer is written to
-- `organizations.logo_path`; the client is handed a path and renders it.

-- ── The bucket ─────────────────────────────────────────────────────────────
-- Public, unlike `documents`. These are government emblems already published on
-- the bodies' own sites — there is nothing here to leak, and a public bucket is
-- served straight from the CDN with no signing round-trip per badge.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'logos',
  'logos',
  true,
  -- 256 kB. The import normalises every file to a 128 px WebP — the largest
  -- comes out around 12 kB — so this is a ceiling on mistakes, not on content.
  262144,
  -- WebP only, and that is a security decision as much as a size one. The old
  -- bucket held four SVGs, and an SVG is a document: it can carry <script>,
  -- which a public bucket will happily serve with an image content type to
  -- anyone who opens the object URL directly. The import rasterises them.
  array['image/webp']
)
on conflict (id) do update
  set public             = true,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ── Who may read, who may write ────────────────────────────────────────────
-- `public = true` above is what makes the object URL work without a token, so
-- no select policy is needed for reads. Writes are another matter: with RLS on
-- `storage.objects` and no insert policy naming a role, only the service key
-- can upload — which is exactly the import script and nothing else. No policy
-- is added here on purpose; adding one is how a bucket becomes writable by
-- every signed-in user without anyone deciding that it should be.

comment on column public.organizations.logo_path is
  'Storage path within the public `logos` bucket, e.g. '
  '"organizations/staff-selection-commission.webp". A path, not a URL, so the '
  'CDN origin stays swappable without a data migration. Resolved offline by '
  'scripts/import-legacy-logos.mjs; null means the UI falls back to initials.';
