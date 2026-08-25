-- ═══════════════════════════════════════════════════════════════════════════
-- 0021 · Module 16 · The home feed
-- ═══════════════════════════════════════════════════════════════════════════
-- The home page has been rendering a hard-coded array of three invented jobs
-- since Module 3. Replacing it needs one thing the schema cannot answer yet:
-- which exams people actually track.
--
-- `exam_attempts` is RLS-protected — an owner sees their own rows and nobody
-- else's, which is right and must not change. So a plain view over it returns
-- nothing to the anonymous client the home page uses. The count has to be
-- computed by something that can see every row and return only the aggregate.

create index if not exists exam_attempts_exam_idx
  on public.exam_attempts (exam_id)
  where exam_id is not null;

-- ── popular_exams ──────────────────────────────────────────────────────────
-- SECURITY DEFINER, which is a decision rather than a convenience, so it is
-- worth being explicit about what it exposes: a count per exam, and nothing
-- else. No user id, no attempt, no status, no way to ask about one person. An
-- exam with three trackers and an exam with three hundred are distinguishable;
-- who they are is not.
--
-- The alternative — a materialised view refreshed by the ingest run — moves
-- the cost off the read path, and is the right answer at a scale this project
-- is nowhere near. At 66 attempt rows, an indexed group-by that runs once per
-- cache invalidation is cheaper than the machinery to avoid it.
create or replace function public.popular_exams(p_limit integer default 8)
returns table (
  id           uuid,
  slug         text,
  name         text,
  short_name   text,
  logo_path    text,
  next_event_at    timestamptz,
  next_event_label text,
  tracked      bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.id, e.slug, e.name, e.short_name, e.logo_path,
    e.next_event_at, e.next_event_label,
    count(a.id) as tracked
  from public.exams e
  join public.exam_attempts a on a.exam_id = e.id
  where e.is_active
  group by e.id
  order by count(a.id) desc, e.name asc
  -- Bounded here rather than trusted from the caller. Every read in this
  -- codebase carries a limit; a function is not an exception to that.
  limit least(greatest(p_limit, 1), 24);
$$;

comment on function public.popular_exams is
  'Exams ranked by how many people track them. SECURITY DEFINER because '
  'exam_attempts is RLS-protected; it returns aggregate counts only and no '
  'attribute of any individual attempt. Returns nothing when nobody tracks '
  'anything yet, and the home page renders one row fewer rather than '
  'inventing a ranking.';

revoke all on function public.popular_exams(integer) from public;
grant execute on function public.popular_exams(integer) to anon, authenticated;
