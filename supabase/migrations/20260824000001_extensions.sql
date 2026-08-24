-- ═══════════════════════════════════════════════════════════════════════════
-- 0001 · Extensions
-- ═══════════════════════════════════════════════════════════════════════════
-- Supabase convention is to install extensions into a dedicated schema rather
-- than public, so that `public` holds only application objects.

create schema if not exists extensions;

-- gen_random_uuid() is built in from PG 13, so pgcrypto is not needed for ids.
create extension if not exists pg_trgm      with schema extensions;  -- fuzzy title search
create extension if not exists unaccent     with schema extensions;  -- fold diacritics in search
create extension if not exists btree_gin    with schema extensions;  -- composite GIN (tsvector + scalar)
create extension if not exists vector       with schema extensions;  -- pgvector, for Module 8

-- ── Search configuration ───────────────────────────────────────────────────
-- Plain 'english' stems reasonably for the Latin-script text these listings
-- use, but it leaves accents alone. Folding them first means "Odisha" and
-- "Odishā", or an accented officer's name, land on the same lexeme.
--
-- This must be IMMUTABLE-safe: it is referenced by a generated column, and
-- Postgres will only allow that if the whole expression is immutable. A custom
-- configuration is, whereas calling unaccent() directly is not.
create text search configuration public.jt_search (copy = pg_catalog.english);

alter text search configuration public.jt_search
  alter mapping for hword, hword_part, word
  with extensions.unaccent, english_stem;

comment on text search configuration public.jt_search is
  'English stemming with diacritic folding. Used by every generated tsvector column.';
