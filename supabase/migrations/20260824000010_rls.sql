-- ═══════════════════════════════════════════════════════════════════════════
-- 0010 · Grants and Row Level Security
-- ═══════════════════════════════════════════════════════════════════════════
-- Two independent layers, and both must permit an operation for it to succeed:
--
--   GRANT   decides whether the role may touch the table at all
--   POLICY  decides which rows, once it may
--
-- Supabase ships a default that grants ALL on every table in `public` to anon
-- and authenticated, leaving RLS as the only thing standing between a visitor
-- and the data. That is one mistake away from a breach. Below, the blanket
-- grant is revoked and each role is given the narrowest set that works — so a
-- forgotten policy fails closed instead of open.

-- ── Reset ──────────────────────────────────────────────────────────────────
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

grant usage on schema public     to anon, authenticated;
grant usage on schema extensions to anon, authenticated;


-- ═══════════════════════════════════════════════════════════════════════════
-- Public content — readable by everyone, writable by nobody through the API
-- ═══════════════════════════════════════════════════════════════════════════
-- Content is written by the sync worker using the secret key, which bypasses
-- RLS. There is deliberately no INSERT/UPDATE/DELETE policy on any table in
-- this section: no API caller, authenticated or not, can modify content.

grant select on public.organizations, public.jobs, public.job_details,
                public.exams, public.exam_updates, public.exam_update_details
  to anon, authenticated;

create policy organizations_public_read on public.organizations
  for select to anon, authenticated using (is_active);

create policy jobs_public_read on public.jobs
  for select to anon, authenticated using (status = 'published');

-- Detail rows inherit their parent's visibility. Reads are single-row by
-- primary key, so the EXISTS costs one index lookup.
create policy job_details_public_read on public.job_details
  for select to anon, authenticated using (
    exists (select 1 from public.jobs j where j.id = job_id and j.status = 'published')
  );

create policy exams_public_read on public.exams
  for select to anon, authenticated using (is_active);

create policy exam_updates_public_read on public.exam_updates
  for select to anon, authenticated using (is_published);

create policy exam_update_details_public_read on public.exam_update_details
  for select to anon, authenticated using (
    exists (select 1 from public.exam_updates u where u.id = exam_update_id and u.is_published)
  );


-- ═══════════════════════════════════════════════════════════════════════════
-- User-owned data — each row visible only to the user who owns it
-- ═══════════════════════════════════════════════════════════════════════════
-- `(select auth.uid())` rather than a bare `auth.uid()` is a performance
-- decision, not a style one: the subquery form is hoisted into an InitPlan and
-- evaluated once per query, where the bare call is re-evaluated per row.

grant select, insert, update, delete on
  public.profiles, public.education_qualifications, public.saved_jobs,
  public.saved_exam_updates, public.exam_attempts, public.documents,
  public.user_calendar_events, public.notification_preferences,
  public.telegram_connections
  to authenticated;

create policy profiles_owner_select on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy profiles_owner_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- No INSERT policy: rows are created by the on_auth_user_created trigger.
-- No DELETE policy: deleting a profile happens by deleting the auth user.

create policy education_owner_all on public.education_qualifications
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy saved_jobs_owner_all on public.saved_jobs
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy saved_exam_updates_owner_all on public.saved_exam_updates
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy exam_attempts_owner_all on public.exam_attempts
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy documents_owner_all on public.documents
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy user_calendar_events_owner_all on public.user_calendar_events
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy notification_preferences_owner_all on public.notification_preferences
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy telegram_connections_owner_all on public.telegram_connections
  for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));


-- ═══════════════════════════════════════════════════════════════════════════
-- Roles — readable by their owner, writable by nobody
-- ═══════════════════════════════════════════════════════════════════════════
-- SELECT only, and no write policy of any kind. Granting a role is an out-of-
-- band operation using the secret key. If an API caller could write here, every
-- other policy in this file would be advisory.

grant select on public.user_roles to authenticated;

create policy user_roles_owner_select on public.user_roles
  for select to authenticated using (user_id = (select auth.uid()));


-- ═══════════════════════════════════════════════════════════════════════════
-- Feedback — anyone may submit, only the author and admins may read
-- ═══════════════════════════════════════════════════════════════════════════
-- The one table an anonymous visitor can write to. Rate limiting lives at the
-- edge (Module 12); the length constraint on `message` is the backstop here.

grant insert on public.suggestions_grievances to anon, authenticated;
grant select on public.suggestions_grievances to authenticated;

create policy suggestions_anyone_insert on public.suggestions_grievances
  for insert to anon, authenticated with check (true);

create policy suggestions_owner_select on public.suggestions_grievances
  for select to authenticated
  using (user_id = (select auth.uid()) or public.has_role('admin'));


-- ═══════════════════════════════════════════════════════════════════════════
-- Admin surfaces
-- ═══════════════════════════════════════════════════════════════════════════
-- Read-only through the API even for admins. Writes go through server actions
-- holding the secret key, so an admin session token is never sufficient on its
-- own to mutate ingestion state.

grant select on public.scraper_sources, public.sync_runs, public.sync_dead_letter
  to authenticated;

create policy scraper_sources_admin_read on public.scraper_sources
  for select to authenticated using (public.has_role('admin'));
create policy sync_runs_admin_read on public.sync_runs
  for select to authenticated using (public.has_role('admin'));
create policy sync_dead_letter_admin_read on public.sync_dead_letter
  for select to authenticated using (public.has_role('admin'));

-- Admins can see unpublished content in the editor.
create policy jobs_admin_read_all on public.jobs
  for select to authenticated using (public.has_role('admin'));
create policy exam_updates_admin_read_all on public.exam_updates
  for select to authenticated using (public.has_role('admin'));


-- ── Executable helpers ─────────────────────────────────────────────────────
grant execute on function public.has_role(text) to authenticated;
