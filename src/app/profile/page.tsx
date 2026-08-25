import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/lib/auth/session";
import { sessionDb } from "@/lib/db/clients";
import { listEducation } from "@/lib/db/queries/education";
import { PROFILE_COLUMNS } from "@/lib/profile/columns";
import { EducationSection } from "./education-section";
import { ProfileForm } from "./profile-form";
import { SignOutButton } from "./sign-out-button";

export const metadata: Metadata = {
  title: "Your profile",
  robots: { index: false, follow: false },
};

/**
 * Everything below the heading belongs to one user, so it cannot be prerendered
 * — and with Cache Components enabled, reading cookies outside a Suspense
 * boundary is a build error rather than a slow route. The heading is therefore
 * static and ships from the CDN, and the personal half streams in behind it.
 *
 * The user is guaranteed present by the time `<PersonalDetails>` runs: the
 * middleware redirects anonymous visitors before this route renders at all.
 * `requireUser` inside it is the second line of defence, not the first.
 */
export default function ProfilePage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 lg:px-6">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Your profile</h1>

      <Suspense fallback={<ProfileFallback />}>
        <PersonalDetails />
      </Suspense>
    </div>
  );
}

async function PersonalDetails() {
  const user = await requireUser("/profile");
  const db = await sessionDb();

  // One round trip each, in parallel. RLS scopes both to this user, and the
  // `.eq` is belt-and-braces for the same reason as in the write actions.
  const [profileResult, education] = await Promise.all([
    db.from("profiles").select(PROFILE_COLUMNS).eq("id", user.id).maybeSingle(),
    // Shared with /for-you, and bounded — the inline version here had an
    // `order` and no `limit`, which is the one unbounded read left in the app.
    listEducation(),
  ]);

  const profile = profileResult.data;

  return (
    <>
      <div className="mt-1 flex items-start justify-between gap-4">
        <p className="min-w-0 truncate text-sm text-ink-2">{user.email}</p>
        <SignOutButton />
      </div>

      {!profile?.onboarding_completed ? (
        <p className="mt-6 rounded-md border border-accent/30 bg-accent/10 px-3 py-2 text-sm text-ink">
          Fill this in once and the For You feed can tell you what you are actually eligible
          for. Every field is optional.
        </p>
      ) : null}

      <section className="mt-8">
        <ProfileForm profile={profile} />
      </section>

      <section className="mt-10">
        <EducationSection education={education} />
      </section>
    </>
  );
}

function ProfileFallback() {
  return (
    <div className="mt-1 flex flex-col gap-5">
      <Skeleton className="h-5 w-48" />
      <div className="mt-6 flex flex-col gap-5">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-9.5 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
