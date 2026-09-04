import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { SignInRequired } from "@/components/auth/sign-in-required";
import { SparklesIcon, UserIcon } from "@/components/icons";
import { getUser } from "@/lib/auth/session";
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
 * A signed-out visitor is no longer redirected here — `<PersonalDetails>` finds
 * no user and renders the sign-in card in place of the form. The heading above
 * it is static either way, so the page they land on is recognisably this page
 * with a reason on it, rather than a password field they did not ask for.
 */
export default function ProfilePage() {
  return (
    <div className="relative mx-auto max-w-3xl px-4 pt-6 pb-20 lg:px-6 lg:pb-12">
      {/* Top back navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-semibold text-ink transition-colors hover:text-ink-2"
        >
          <span className="text-base font-bold" aria-hidden="true">
            ←
          </span>
          <span>Home</span>
        </Link>
      </div>

      {/* Hero Header matching Job Details */}
      <header className="mt-4 flex items-start gap-3.5 sm:gap-5">
        {/* Left: Icon Squircle Plate */}
        <div
          className="relative flex size-14 sm:size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-line/70 bg-logo-plate p-2 shadow-xs"
          aria-hidden="true"
        >
          <UserIcon className="size-7 text-brand" />
        </div>

        {/* Right: Title & Subtitle */}
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-extrabold leading-tight tracking-tight text-ink">
            Your profile
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-ink-2 leading-relaxed">
            Manage your personal details, eligibility criteria, and job preferences.
          </p>
        </div>
      </header>

      <Suspense fallback={<ProfileFallback />}>
        <PersonalDetails />
      </Suspense>
    </div>
  );
}

async function PersonalDetails() {
  // Before the first read, so a guest costs no query — the same as the redirect
  // that used to stand here, with a sentence attached.
  const user = await getUser();
  if (!user) {
    return (
      <div className="mt-6">
        <SignInRequired
          title="Sign in to see your profile"
          description="Your details live in your account. Add them once and every form, match and reminder on JobsTrackr uses them."
          next="/profile"
          icon={UserIcon}
        />
      </div>
    );
  }

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
      {/* Account Info Bar */}
      <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-3.5 shadow-xs sm:px-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-ink-3">Signed in as</p>
          <p className="truncate text-sm font-semibold text-ink">{user.email}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/my-details"
            className="hidden items-center rounded-xl border border-line bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink-2 transition-colors hover:border-line-strong hover:text-ink sm:inline-flex"
          >
            Copy my details →
          </Link>
          <SignOutButton />
        </div>
      </div>

      {!profile?.onboarding_completed ? (
        <div className="mt-5 flex items-start gap-3.5 rounded-2xl border border-brand/30 bg-brand-soft/40 p-4 shadow-2xs sm:p-5">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
            <SparklesIcon className="size-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1 text-xs leading-relaxed text-ink-2 sm:text-sm">
            <p className="font-bold text-ink">Complete your profile</p>
            <p className="mt-1">
              Fill this in once and the For You feed can tell you what you are actually eligible
              for. Every field is optional.
            </p>
            <Link
              href="/"
              className="mt-2 inline-block text-xs font-semibold text-brand hover:underline"
            >
              Skip for now →
            </Link>
          </div>
        </div>
      ) : null}

      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2.5">
          <span className="h-4.5 w-1 shrink-0 rounded-full bg-brand" aria-hidden="true" />
          <h2 className="text-base sm:text-lg font-bold tracking-tight text-ink">
            Personal details & preferences
          </h2>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-4 shadow-xs sm:p-6">
          <ProfileForm profile={profile} />
        </div>
      </section>

      <section className="mt-10">
        <div className="mb-3">
          <div className="flex items-center gap-2.5">
            <span className="h-4.5 w-1 shrink-0 rounded-full bg-brand" aria-hidden="true" />
            <h2 className="text-base sm:text-lg font-bold tracking-tight text-ink">
              Qualifications
            </h2>
          </div>
          <p className="mt-1 text-xs sm:text-sm text-ink-3">
            One entry per qualification level. Adding a level you already have replaces it.
          </p>
        </div>
        <EducationSection education={education} />
      </section>
    </>
  );
}

function ProfileFallback() {
  return (
    <div className="mt-6 flex flex-col gap-6" aria-hidden="true">
      <div className="h-14 rounded-2xl border border-line bg-surface p-3.5 shadow-xs" />
      <div>
        <div className="mb-3 flex items-center gap-2.5">
          <div className="h-4.5 w-1 rounded-full bg-brand/40" />
          <div className="skeleton h-5 w-44 rounded-md" />
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs">
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex flex-col gap-1.5">
                <div className="skeleton h-3 w-24 rounded" />
                <div className="skeleton h-9.5 w-full rounded-md" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
