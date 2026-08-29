-- ═══════════════════════════════════════════════════════════════════════════
-- 0026 · Module 22 · Feedback can say which kind it is
-- ═══════════════════════════════════════════════════════════════════════════
-- `suggestions_grievances` was created with email, message and status, and the
-- name says the rest: it holds two different things. The old app's dialog wrote
-- a `type` column of 'suggestion' | 'grievance' and this table has no column
-- for it, so ported literally every grievance would have arrived in the queue
-- indistinguishable from a feature request — the same row, the same triage, the
-- same wait.
--
-- Named `kind`, not `type`. `type` is reserved or shadowed in enough places —
-- PL/pgSQL, several client generators — to be worth avoiding, and nothing reads
-- the old column name.
--
-- Defaulted to 'suggestion' so the column can be added to a table that already
-- has rows without a rewrite, and because a message that did not say is far
-- more likely to be one.

alter table public.suggestions_grievances
  add column kind text not null default 'suggestion'
    constraint suggestions_kind_known check (kind in ('suggestion', 'grievance'));

comment on column public.suggestions_grievances.kind is
  'suggestion | grievance. A grievance is a complaint about something that is '
  'broken or wrong and is triaged ahead of suggestions.';

-- Grievances are what somebody has to look at today, so give them their own
-- partial index rather than making the open-queue index carry the predicate.
create index suggestions_open_grievance_idx
  on public.suggestions_grievances (created_at desc)
  where status = 'open' and kind = 'grievance';


-- ── Close the insert policy ────────────────────────────────────────────────
-- The original policy is `with check (true)` for anon and authenticated, which
-- is wider than it needs to be: it accepts a row claiming any `user_id` at all.
-- Nothing in this app writes one — the server action reads the id from the
-- session — but the policy is what a direct PostgREST call is held to, and as
-- written that call could file a grievance in somebody else's name.
--
-- Anonymous feedback stays possible. A null `user_id` is the anonymous case and
-- is still accepted from anyone; what is no longer accepted is a non-null id
-- that is not your own.

drop policy suggestions_anyone_insert on public.suggestions_grievances;

create policy suggestions_anyone_insert on public.suggestions_grievances
  for insert to anon, authenticated
  with check (user_id is null or user_id = (select auth.uid()));
