import type { Metadata } from "next";
import Link from "next/link";

import { LEGAL_CONTACT, LEGAL_UPDATED } from "@/lib/legal/meta";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "What JobsTrackr stores about you, why, and how to have it deleted. We do not sell personal data.",
  alternates: { canonical: "/privacy-policy" },
};

/**
 * Privacy policy.
 *
 * Rewritten rather than ported. The old app's policy described collecting
 * aadhaar, PAN and passport numbers, running OCR over uploaded certificates and
 * filling forms from them. This schema has no columns for any of that — it was
 * dropped deliberately in the rebuild, and the migration script drops those
 * values rather than carrying them across. Reprinting the old text would have
 * described a system that does not exist, which is the one thing a privacy
 * policy must never do.
 *
 * Every item below maps to a real column. If a column is added, this page is
 * part of the change.
 */
export default function PrivacyPolicyPage() {
  return (
    <>
      <h1>Privacy policy</h1>
      <p className="!mt-2 text-sm">Last updated {LEGAL_UPDATED}</p>

      <p>
        JobsTrackr helps you find government job notifications and track exam deadlines. This
        page describes exactly what we store about you and why. It covers the website at
        jobstrackr.in.
      </p>

      <h2>What we store</h2>
      <p>
        You can browse every job and exam update on this site without an account, and without us
        storing anything about you. If you create one, we store:
      </p>
      <ul>
        <li>
          <strong>Your email address and password.</strong> Handled by Supabase Auth. Passwords
          are stored only as a bcrypt hash — we never see or keep the password itself.
        </li>
        <li>
          <strong>Profile details you enter:</strong> name, phone number, date of birth, gender,
          reservation category, state and district.
        </li>
        <li>
          <strong>Eligibility details,</strong> because they are what the recommendations match
          against: your highest qualification, discipline, year of passing, institution and
          years of experience.
        </li>
        <li>
          <strong>What you have saved and tracked:</strong> saved jobs, saved updates, the exams
          on your tracker, and any calendar entries you add.
        </li>
        <li>
          <strong>Your preferences:</strong> preferred sectors and states, and your notification
          settings.
        </li>
      </ul>

      <h2>What we deliberately do not store</h2>
      <p>
        We do not collect or store aadhaar numbers, PAN, passport numbers, caste or income
        certificate numbers, disability certificates, or scanned signatures and thumb
        impressions. An earlier version of this app did. The database was rebuilt without
        columns for any of it, and those values were discarded rather than migrated.
      </p>
      <p>
        We do not sell, rent or trade personal data, and we do not run advertising or
        third-party tracking scripts on this site.
      </p>

      <h2>Why we store it</h2>
      <ul>
        <li>To sign you in and keep you signed in.</li>
        <li>
          To match job notifications against your eligibility, so the For You feed can rule out
          listings you cannot apply for.
        </li>
        <li>To show your saved jobs and tracked exams on whichever device you sign in from.</li>
        <li>To send the exam notifications you have asked for, if you turn them on.</li>
      </ul>

      <h2>Who can see it</h2>
      <p>
        Your rows are readable only by your own signed-in session. This is enforced in the
        database itself through row-level security, not only in application code, so a bug in a
        page cannot expose another person&rsquo;s data.
      </p>
      <p>
        Data is stored with <a href="https://supabase.com/privacy">Supabase</a> in their Mumbai
        region, and the site is served by{" "}
        <a href="https://vercel.com/legal/privacy-policy">Vercel</a>. Those two providers
        process data on our behalf so that the site can run. Nobody else receives it.
      </p>

      <h2>How long we keep it</h2>
      <p>
        For as long as your account exists. Delete your account and the associated rows are
        removed with it — saved jobs, tracker entries, education records and profile.
      </p>

      <h2>Your choices</h2>
      <ul>
        <li>
          Edit or clear any profile field at any time from{" "}
          <Link href="/profile">your profile</Link>.
        </li>
        <li>Turn notifications off from the same page.</li>
        <li>
          Ask us to delete your account and everything attached to it, by emailing{" "}
          <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>. We action deletion requests
          within 30 days.
        </li>
      </ul>

      <h2>Children</h2>
      <p>
        The site is intended for people applying to government recruitment, which sets its own
        minimum ages. It is not directed at children under 13, and we do not knowingly collect
        their data.
      </p>

      <h2>Changes</h2>
      <p>
        If what we store changes, this page changes with it and the date at the top moves. For
        anything else, write to <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>.
      </p>
    </>
  );
}
