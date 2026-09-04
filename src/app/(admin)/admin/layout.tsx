import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { hasRole } from "@/lib/auth/session";

/**
 * Admin never prerenders.
 *
 * Every route under here reads the session to decide whether the visitor is an
 * admin at all, so there is no static shell to serve — and unlike the public
 * pages, there is nobody to serve it to: this route group is not linked from
 * anywhere, is `noindex`, and is reached by three people. Cache Components
 * would otherwise fail the build for reading cookies outside a Suspense
 * boundary, and wrapping a gate in Suspense purely to satisfy that would let
 * the page's own queries start before the gate had decided.
 */
export const instant = false;

/**
 * Deliberately the site's default title, not "Admin".
 *
 * `notFound()` below is supposed to tell a signed-in non-admin nothing — but
 * metadata resolves for the matched route regardless of what the render throws,
 * so a distinctive title here (or on any page under it) survives into the 404
 * and confirms the route exists. Measured: /admin returned "Overview ·
 * JobsTrackr" while a genuine 404 returned the default. Now they are identical.
 *
 * The cost is that real admins get an undifferentiated tab title. There are
 * three of them and they know which page they are on.
 */
export const metadata: Metadata = {
  // `absolute`, or the root's "%s · JobsTrackr" template appends a second
  // suffix and the title becomes distinctive again by a different route.
  title: { absolute: "JobsTrackr — Government jobs and exam updates" },
  robots: { index: false, follow: false, nocache: true },
};

/**
 * The admin shell, and the only gate in front of it.
 *
 * `notFound()` rather than a redirect or a 403. A signed-in non-admin who
 * guesses this URL learns nothing from a 404 — not that the route exists, not
 * that they lack a role. A "forbidden" page confirms both.
 *
 * This is defence in depth rather than the only defence. Every admin query goes
 * through RLS policies that check `has_role('admin')` independently, and every
 * write re-checks before touching the secret-key client. If this layout were
 * removed tomorrow the data would still be safe; it exists so the failure is a
 * 404 instead of an empty table.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await hasRole("admin");
  if (!admin) notFound();

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 lg:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-ink">Admin</h1>
          <p className="text-xs text-ink-3">
            Ingestion, content and egress. Not linked from anywhere public.
          </p>
        </div>

        <nav aria-label="Admin sections" className="flex flex-wrap gap-1">
          <AdminLink href="/admin">Overview</AdminLink>
          <AdminLink href="/admin/jobs">Jobs</AdminLink>
          <AdminLink href="/admin/expired">Expired</AdminLink>
          <AdminLink href="/admin/updates">Updates</AdminLink>
          <AdminLink href="/admin/feedback">Feedback</AdminLink>
          <AdminLink href="/admin/discover">Discover</AdminLink>
          <AdminLink href="/admin/logos">Logos</AdminLink>
          <AdminLink href="/admin/users">Users</AdminLink>
          <AdminLink href="/admin/api">API</AdminLink>
          <AdminLink href="/admin/egress">Egress</AdminLink>
        </nav>
      </header>

      {children}
    </div>
  );
}

function AdminLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-md px-3 py-1.5 text-sm font-medium text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
    >
      {children}
    </Link>
  );
}
