import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

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
 * The page is `noindex, nofollow` and behind `requireUser`. It is one person's
 * identity data and has no business in a search result.
 */
export default function MyDetailsPage() {
  return (
    <div className="mx-auto w-full max-w-[68ch] px-4 py-10 sm:px-6 lg:py-14">
      <h1 className="font-cond text-3xl font-bold tracking-tight text-balance text-ink">
        Copy my details
      </h1>
      <p className="mt-4 leading-relaxed text-ink-2">
        Everything a government application form asks for, in the order it usually asks. Tap
        Copy on a row and paste it straight into the form.
      </p>

      <Suspense fallback={<Skeleton />}>
        <Details />
      </Suspense>
    </div>
  );
}

async function Details() {
  const [profile, education] = await Promise.all([getPiiProfile(), getEducationForForms()]);

  const filled = Object.values(profile).filter(Boolean).length;

  return (
    <>
      {filled === 0 ? (
        <div className="mt-8 rounded-md border border-dashed border-line px-4 py-8 text-center">
          <p className="font-semibold text-ink">Nothing saved yet</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-3">
            Fill in your profile and this page fills itself in — or scan a marksheet and let us
            read the details out of it.
          </p>
          <p className="mt-4 flex flex-wrap justify-center gap-4 text-sm">
            <Link href="/profile" className="font-medium text-accent hover:underline">
              Edit profile
            </Link>
            <Link href="/documents" className="font-medium text-accent hover:underline">
              Scan a document
            </Link>
          </p>
        </div>
      ) : null}

      {PII_GROUPS.map((group) => {
        const rows = group.fields.filter((f) => profile[f.key]);
        // A group with nothing in it renders as nothing, rather than as a
        // heading over an empty box.
        if (rows.length === 0) return null;

        return (
          <section key={group.title} className="mt-8">
            <h2 className="text-lg font-semibold text-ink">{group.title}</h2>
            {group.hint ? <p className="mt-1 text-sm text-ink-3">{group.hint}</p> : null}
            <div className="mt-2.5 rounded-md border border-line bg-surface px-3.5">
              {rows.map((field) => (
                <CopyField
                  key={field.key}
                  label={field.label}
                  value={format(profile[field.key] ?? null, field.isDate)}
                  {...(field.secret ? { secret: field.secret } : {})}
                />
              ))}
            </div>
          </section>
        );
      })}

      {education.length > 0 ? (
        <section className="mt-8">
          <h2 className="text-lg font-semibold text-ink">Education</h2>
          {education.map((row, index) => (
            <div
              key={`${row.level}-${String(index)}`}
              className="mt-2.5 rounded-md border border-line bg-surface px-3.5"
            >
              <p className="border-b border-line py-2.5 text-xs font-semibold tracking-wide text-ink-3 uppercase">
                {qualificationLabel(row.level)}
              </p>
              <CopyField label="Discipline" value={row.discipline} />
              <CopyField label="Institution" value={row.institution} />
              <CopyField label="Board / University" value={row.board_university} />
              <CopyField
                label="Year of passing"
                value={row.year_of_passing === null ? null : String(row.year_of_passing)}
              />
              <CopyField
                label="Percentage"
                value={row.percentage === null ? null : String(row.percentage)}
              />
            </div>
          ))}
        </section>
      ) : null}

      <p className="mt-10 border-t border-line pt-6 text-sm leading-relaxed text-ink-3">
        Your identity numbers are stored encrypted and shown here masked. Pressing Copy fetches
        that one number for you and puts it on the clipboard — it is never displayed on this
        page, and the other two are not fetched.
      </p>
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
    <div className="mt-8 flex flex-col gap-6" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i}>
          <div className="h-5 w-32 rounded bg-surface-2" />
          <div className="mt-2.5 h-40 rounded-md border border-line bg-surface-2" />
        </div>
      ))}
    </div>
  );
}
