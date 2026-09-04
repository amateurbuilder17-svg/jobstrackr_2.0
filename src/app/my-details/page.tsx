import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import {
  CopyIcon,
  GraduationCapIcon,
  ScanTextIcon,
  ShieldCheckIcon,
  UserIcon,
} from "@/components/icons";
import { SignInRequired } from "@/components/auth/sign-in-required";
import { getUser } from "@/lib/auth/session";
import { QUALIFICATION_LABELS } from "@/lib/profile/enums";
import { getEducationForForms, getPiiProfile } from "@/lib/db/queries/pii";
import { PII_GROUPS } from "@/lib/profile/pii";
import { CopyField } from "./copy-field";

export const metadata: Metadata = {
  title: "Copy my details",
  description: "Your saved details, one tap each, for any government application form.",
  robots: { index: false, follow: false },
};

/**
 * Copy my details.
 *
 * The old app called this FormMate. The name told nobody what it did; this page
 * is a list of the things an application form asks for, each with a copy
 * button, so filling one is a sequence of taps rather than a hunt through
 * certificates.
 *
 * Everything except the copy buttons is a Server Component. The values are read
 * under RLS for the signed-in user and rendered as HTML — with the three
 * identity numbers rendered *masked*, because that is what is stored.
 *
 * The page is `noindex, nofollow`, and a signed-out visitor gets a sign-in card
 * where the fields would be rather than a query. It is one person's identity
 * data and has no business in a search result.
 */
export default function MyDetailsPage() {
  return (
    <div className="relative mx-auto max-w-3xl px-4 pt-6 pb-20 lg:px-6 lg:pb-12">
      {/* Top back navigation */}
      <div className="flex items-center justify-between">
        <Link
          href="/profile"
          className="inline-flex items-center gap-2 text-sm font-semibold text-ink transition-colors hover:text-ink-2"
        >
          <span className="text-base font-bold" aria-hidden="true">
            ←
          </span>
          <span>Profile</span>
        </Link>
      </div>

      {/* Hero Header matching Job Details */}
      <header className="mt-4 flex items-start gap-3.5 sm:gap-5">
        {/* Left: Icon Squircle Plate */}
        <div
          className="relative flex size-14 sm:size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-line/70 bg-logo-plate p-2 shadow-xs"
          aria-hidden="true"
        >
          <CopyIcon className="size-7 text-brand" />
        </div>

        {/* Right: Title & Tags */}
        <div className="min-w-0 flex-1">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-extrabold leading-tight tracking-tight text-ink">
            Copy my details
          </h1>

          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-good/25 bg-good-soft px-2.5 py-0.5 text-xs font-medium text-good leading-normal">
              One-tap copy for forms
            </span>
            <span className="inline-flex items-center rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs font-medium text-ink-2 leading-normal">
              Encrypted & masked
            </span>
          </div>
        </div>
      </header>

      <p className="mt-3.5 text-sm text-ink-2 leading-relaxed">
        Everything a government application form asks for, in the order it usually asks. Tap
        Copy on a row and paste it straight into the form.
      </p>

      {/* Quick Action Buttons */}
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <Link
          href="/profile"
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-xs sm:text-sm font-semibold text-ink shadow-xs transition-colors hover:border-line-strong hover:bg-surface-2"
        >
          <UserIcon className="size-4 text-ink-3" aria-hidden="true" />
          <span>Edit profile</span>
        </Link>
        <Link
          href="/documents"
          className="inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-xs sm:text-sm font-semibold text-ink shadow-xs transition-colors hover:border-line-strong hover:bg-surface-2"
        >
          <ScanTextIcon className="size-4 text-ink-3" aria-hidden="true" />
          <span>Scan a document</span>
        </Link>
      </div>

      <Suspense fallback={<Skeleton />}>
        <Details />
      </Suspense>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
  id,
}: {
  title: string;
  hint?: string | undefined;
  children: React.ReactNode;
  id?: string | undefined;
}) {
  return (
    <section className="mt-8" id={id}>
      <div className="mb-3">
        <div className="flex items-center gap-2.5">
          <span className="h-4.5 w-1 shrink-0 rounded-full bg-brand" aria-hidden="true" />
          <h2 className="text-base sm:text-lg font-bold tracking-tight text-ink">{title}</h2>
        </div>
        {hint ? <p className="mt-1 text-xs sm:text-sm text-ink-3">{hint}</p> : null}
      </div>
      <div>{children}</div>
    </section>
  );
}

async function Details() {
  // Ahead of both reads. These are identity fields — there is nothing here for
  // somebody without an account, and nothing worth querying for them either.
  const user = await getUser();
  if (!user) {
    return (
      <SignInRequired
        title="Sign in to copy your details"
        description="Save your details once and this page hands you every field a government form asks for, one tap each."
        next="/my-details"
        icon={CopyIcon}
      />
    );
  }

  const [profile, education] = await Promise.all([getPiiProfile(), getEducationForForms()]);

  const filled = Object.values(profile).filter(Boolean).length + education.length;

  return (
    <>
      {filled === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-line bg-surface/40 p-8 text-center sm:p-12">
          <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-line bg-logo-plate text-ink-3 shadow-xs">
            <CopyIcon className="size-6 text-brand" aria-hidden="true" />
          </div>
          <p className="mt-4 text-base font-bold text-ink">Nothing saved yet</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-2">
            Fill in your profile and this page fills itself in — or scan a marksheet and let us
            read the details out of it.
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link
              href="/profile"
              className="inline-flex h-10 items-center justify-center rounded-xl bg-brand px-5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-brand-deep"
            >
              Edit profile
            </Link>
            <Link
              href="/documents"
              className="inline-flex h-10 items-center justify-center rounded-xl border border-line bg-surface px-5 text-sm font-medium text-ink transition-colors hover:border-line-strong hover:bg-surface-2"
            >
              Scan a document
            </Link>
          </div>
        </div>
      ) : null}

      {PII_GROUPS.map((group) => {
        const rows = group.fields.filter((f) => profile[f.key]);
        // A group with nothing in it renders as nothing, rather than as a
        // heading over an empty box.
        if (rows.length === 0) return null;

        return (
          <Section key={group.title} title={group.title} hint={group.hint}>
            <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
              {rows.map((field) => (
                <CopyField
                  key={field.key}
                  label={field.label}
                  value={format(profile[field.key] ?? null, field.isDate)}
                  {...(field.secret ? { secret: field.secret } : {})}
                />
              ))}
            </div>
          </Section>
        );
      })}

      {education.length > 0 ? (
        <Section title="Education">
          <div className="space-y-4">
            {education.map((row, index) => (
              <div
                key={`${row.level}-${String(index)}`}
                className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-xs"
              >
                <div className="flex items-center justify-between border-b border-line bg-surface-2/60 px-4 py-2.5 sm:px-5 sm:py-3">
                  <div className="flex items-center gap-2">
                    <GraduationCapIcon className="size-4 text-brand" aria-hidden="true" />
                    <span className="text-xs font-bold tracking-wider text-ink uppercase">
                      {qualificationLabel(row.level)}
                    </span>
                  </div>
                  {row.year_of_passing ? (
                    <span className="tabular text-xs font-medium text-ink-3">
                      Class of {row.year_of_passing}
                    </span>
                  ) : null}
                </div>
                <CopyField label="Discipline" value={row.discipline} />
                <CopyField label="Institution" value={row.institution} />
                <CopyField label="Board / University" value={row.board_university} />
                <CopyField
                  label="Year of passing"
                  value={row.year_of_passing === null ? null : String(row.year_of_passing)}
                />
                <CopyField
                  label="Percentage / Score"
                  value={row.percentage === null ? null : String(row.percentage)}
                />
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      {/* Security callout matching Job Details card treatment */}
      <div className="mt-10 flex items-start gap-3.5 rounded-2xl border border-line/80 bg-surface-2/50 p-4 shadow-2xs sm:p-5">
        <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <ShieldCheckIcon className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1 text-xs leading-relaxed text-ink-2 sm:text-sm">
          <p className="font-bold text-ink">Encrypted identity protection</p>
          <p className="mt-1">
            Your identity numbers (Aadhaar, PAN, Passport) are stored encrypted and shown here
            masked. Pressing Copy fetches that one number for you and puts it on the clipboard —
            it is never displayed in plaintext on this page, and the other two are not fetched.
          </p>
        </div>
      </div>
    </>
  );
}

/**
 * The human name for a qualification level, or the stored value.
 *
 * Widened to `Record<string, string>` on purpose rather than cast to the enum's
 * key union: the value comes from the database, and a row written before a
 * level was renamed is a real possibility. Falling back to the raw value shows
 * something true rather than `undefined`.
 */
function qualificationLabel(level: string): string {
  const labels: Record<string, string> = QUALIFICATION_LABELS;
  return labels[level] ?? level;
}

/** Dates as a person writes them; everything else as stored. */
function format(value: string | null, isDate?: boolean): string | null {
  if (!value) return null;
  if (!isDate) return value;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function Skeleton() {
  return (
    <div className="mt-8 flex flex-col gap-8" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i}>
          <div className="mb-3 flex items-center gap-2.5">
            <div className="h-4.5 w-1 rounded-full bg-brand/40" />
            <div className="skeleton h-5 w-32 rounded-md" />
          </div>
          <div className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface shadow-xs">
            {[0, 1, 2].map((j) => (
              <div
                key={j}
                className="flex items-center justify-between px-4 py-3 sm:px-5 sm:py-3.5"
              >
                <div className="space-y-1.5">
                  <div className="skeleton h-3 w-20 rounded" />
                  <div className="skeleton h-4 w-36 rounded" />
                </div>
                <div className="skeleton h-8 w-16 rounded-xl" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
