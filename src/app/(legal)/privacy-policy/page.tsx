import type { Metadata } from "next";
import Link from "next/link";

import { LEGAL_CONTACT, LEGAL_UPDATED } from "@/lib/legal/meta";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "What JobsTrackr stores about you, what Google sign-in gives us, what happens to a document you scan, and how to have all of it deleted. We do not sell personal data.",
  alternates: { canonical: "/privacy-policy" },
};

/**
 * Privacy policy.
 *
 * Rewritten rather than ported. The old app's policy described collecting
 * aadhaar, PAN and passport *numbers* as profile columns and filling forms from
 * them. This schema has no columns for any of that, and the migration script
 * drops those values rather than carrying them across.
 *
 * What the first rewrite then got wrong, and this one fixes: it turned that
 * into "we do not collect aadhaar, PAN or caste certificates" — which stopped
 * being true the day Module 25 shipped. `/documents` accepts a photograph of
 * exactly those, keeps it in a private Supabase bucket, and sends it to the free
 * tier of Google's Gemini API to be read — a tier whose terms let Google train on
 * what it is sent and let human reviewers read it. Migration 0030 says what is in
 * that bucket, in its own header comment. A
 * policy that denies a feature the app ships is worse than no policy: it is the
 * one document that must never describe a system that does not exist, in either
 * direction.
 *
 * Every item below maps to a real column, a real bucket or a real outbound
 * request. If one is added, this page is part of that change — and so is the
 * date in `lib/legal/meta.ts`, which means the last time somebody edited these
 * words, not the last time the site deployed.
 *
 * The "Signing in with Google" section is also a compliance surface, not only a
 * courtesy. Google's OAuth verification requires a policy that names the scopes
 * requested, says what is done with the data they return, and carries the
 * Limited Use sentence verbatim. Removing or softening that section fails
 * review, and a failed review is a sign-in button that stops working.
 */
export default function PrivacyPolicyPage() {
  return (
    <>
      <h1>Privacy policy</h1>
      <p className="!mt-2 text-sm">Last updated {LEGAL_UPDATED}</p>

      <p>
        JobsTrackr helps you find Indian government job notifications, check what you are
        eligible for, and track exam deadlines. This policy covers the website at jobstrackr.in
        and describes exactly what we store about you, who processes it, how long it stays, and
        how to have it removed. It is the whole of it — there is no second policy elsewhere.
      </p>
      <p>
        We do not sell, rent or trade personal data. We run no advertising and no third-party
        analytics or tracking scripts.
      </p>

      <h2>Browsing without an account</h2>
      <p>
        Every job, exam update, syllabus and countdown on this site is readable without signing
        in, and we store nothing about you for it. Jobs you save as a guest are kept in your own
        browser&rsquo;s local storage and never reach us until you create an account and choose
        to merge them.
      </p>

      <h2>What we store when you have an account</h2>
      <ul>
        <li>
          <strong>Your email address, and a password if you set one.</strong> Handled by
          Supabase Auth. Passwords are stored only as a bcrypt hash — we never see or keep the
          password itself. If you only ever sign in with Google, there is no password at all.
        </li>
        <li>
          <strong>Profile details you enter:</strong> name, mobile number, date of birth,
          gender, reservation category, state and district.
        </li>
        <li>
          <strong>Eligibility details,</strong> because they are what the recommendations match
          against: your highest qualification, discipline, year of passing, institution and
          years of experience.
        </li>
        <li>
          <strong>What you have saved and tracked:</strong> saved jobs, saved updates, the exams
          on your tracker, your attempt history and any calendar entries you add.
        </li>
        <li>
          <strong>Your preferences:</strong> preferred sectors and states, and your notification
          settings.
        </li>
        <li>
          <strong>Documents you choose to scan,</strong> covered in its own section below.
        </li>
      </ul>

      <h2>Signing in with Google</h2>
      <p>
        Google sign-in is optional. Using it, we ask Google for three standard scopes and
        nothing else:
      </p>
      <ul>
        <li>
          <code>openid</code> — a stable identifier for your Google account, so that signing in
          again returns you to the same JobsTrackr account.
        </li>
        <li>
          <code>email</code> — your email address and whether Google has verified it.
        </li>
        <li>
          <code>profile</code> — your name and the URL of your Google profile picture.
        </li>
      </ul>
      <p>
        <strong>What we do with it.</strong> Those three things are used for one purpose:
        creating your JobsTrackr account and identifying you when you return. Your email address
        becomes your account address and is what we write to about your account. Your name
        pre-fills the name field on your profile, where you can change or clear it.
      </p>
      <p>
        <strong>Where it is stored.</strong> In the same Supabase project as the rest of your
        account, in Supabase&rsquo;s authentication tables, under the same row-level security as
        everything else. It is not copied anywhere else.
      </p>
      <p>
        <strong>What we never ask for.</strong> We request no access to Gmail, Google Drive,
        Google Calendar, Google Contacts, Google Photos, or any other Google service. We cannot
        read, send or change anything in your Google account, and there is no scope on our
        client that would let us.
      </p>
      <p>
        <strong>Who we share it with.</strong> Nobody. Google account data is not sold,
        transferred or disclosed to any third party, other than the infrastructure providers
        listed below that host the database it sits in, and except where the law requires it.
      </p>
      <p>
        JobsTrackr&rsquo;s use and transfer of information received from Google APIs to any
        other app will adhere to the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements.
      </p>
      <p>
        <strong>Taking it back.</strong> You can revoke our access at any time from{" "}
        <a href="https://myaccount.google.com/permissions">
          your Google account&rsquo;s third-party access page
        </a>
        . That stops future sign-ins. It does not delete your JobsTrackr account or the data
        already in it — to remove those, use the deletion route under &ldquo;Your rights&rdquo;
        below.
      </p>
      <p>
        On the sign-in, sign-up and forgot-password screens only, your browser loads
        Google&rsquo;s sign-in script from <code>accounts.google.com</code> so the button can
        work. It is not loaded anywhere else on the site, and it is not an analytics or
        advertising script.
      </p>

      <h2>Documents you scan</h2>
      <p>
        This is the most sensitive thing on the site, so it gets a plain description rather than
        a line in a list.
      </p>
      <p>
        <Link href="/documents">Scan a document</Link> lets you photograph an identity proof
        (Aadhaar, PAN or passport), a marksheet, a passing or degree certificate, a caste
        certificate, or another eligibility document such as EWS, disability or ex-serviceman
        proof — so that the details on it can fill your profile instead of being typed by hand.
        Nothing about it is automatic: <strong>the feature is entirely optional</strong>, and
        you see every field that was read and tick the ones you want kept before anything is
        written to your profile.
      </p>
      <p>Using it means four things are true, and you should know all four:</p>
      <ul>
        <li>
          <strong>The file is stored.</strong> It goes into a private Supabase storage bucket,
          in a folder named after your user id, reachable only by your own signed-in session.
          The bucket is not public: there is no URL anyone can guess that serves it. We also
          record its type, size and upload time.
        </li>
        <li>
          <strong>The image is sent to Google&rsquo;s Gemini API to be read.</strong> This is a
          transfer of your document to a third party, and it is the only way the feature works.
          What is sent is the image and an instruction to extract fields from it — not your
          account, your email address, or anything else from your profile.
        </li>
        <li>
          <strong>
            We use the free tier of that API, and you should know what that means before you
            upload anything.
          </strong>{" "}
          Under the <a href="https://ai.google.dev/gemini-api/terms">Gemini API terms</a>,
          content sent to the unpaid tier may be used by Google to develop and improve its
          products and machine learning models, and <strong>human reviewers may read it</strong>
          . Google says it disconnects such content from your API key and account before any
          human sees it. Google&rsquo;s own terms tell developers not to send sensitive or
          personal information to the unpaid tier. We are saying so plainly rather than burying
          it, because the documents this feature is for are exactly that.
        </li>
        <li>
          <strong>Only what you approve is kept as profile data.</strong> Values you do not tick
          are discarded. We do not store the number from an Aadhaar, PAN, passport, or caste
          certificate as a profile field — the schema has no column for one — but the photograph
          you uploaded does contain it, and that photograph is retained until you delete it.
        </li>
      </ul>
      <p>
        <strong>You can delete any scanned document at any time</strong>, from the same page.
        That removes both the stored file and its record — though it cannot recall a copy
        already sent to Google to be read.
      </p>
      <p>
        <strong>
          Our advice, given the paragraph above: think twice before scanning an identity
          document.
        </strong>{" "}
        Every field this feature fills can be typed into{" "}
        <Link href="/profile">your profile</Link> by hand in a minute, and doing that keeps the
        document on your own device. A marksheet carries less than an Aadhaar card does; treat
        them differently. If we move this feature to a paid tier — where Google does not use
        submitted content to improve its models — this page will say so and the date at the top
        will move.
      </p>

      <h2>What we do not collect</h2>
      <p>
        We do not run advertising, behavioural profiling, or third-party analytics. We do not
        store your Aadhaar, PAN, passport or certificate <em>numbers</em> as fields in your
        profile — an earlier version of this app did, and the database was rebuilt without
        columns for any of them, with those values discarded rather than migrated. We do not
        collect precise location, contacts, or anything from your device beyond what a web page
        ordinarily receives.
      </p>

      <h2>Information collected automatically</h2>
      <p>
        Like any website, this one is served by machines that keep operational logs. Vercel, our
        host, records the IP address, approximate location, user agent and requested URL of
        requests, and Supabase logs database and authentication activity. These are used to keep
        the site running, to investigate errors, and to stop abuse. They are not joined to your
        profile to build a picture of you, and they are not used for advertising.
      </p>

      <h2>Cookies and local storage</h2>
      <p>We set no advertising or tracking cookies. What is stored in your browser is:</p>
      <ul>
        <li>
          <strong>Session cookies</strong> from Supabase Auth, which are what keep you signed
          in. Clearing them signs you out.
        </li>
        <li>
          <strong>Local storage</strong> for your theme choice, jobs you saved before signing
          in, and a queue of changes made while offline so they are not lost.
        </li>
        <li>
          <strong>A service worker cache</strong> of pages and assets, so the site still opens
          on a poor connection. It holds published content, not your personal data.
        </li>
      </ul>

      <h2>Who processes your data</h2>
      <p>
        Only the providers below, and only so that the site can run. Each processes data on our
        behalf under its own terms; none of them is given your data for their own marketing.
      </p>
      <dl>
        <dt>
          <a href="https://supabase.com/privacy">Supabase</a>
        </dt>
        <dd>Database, authentication and document storage. Hosted in the Mumbai region.</dd>
        <dt>
          <a href="https://vercel.com/legal/privacy-policy">Vercel</a>
        </dt>
        <dd>Hosting and content delivery for the site itself.</dd>
        <dt>
          <a href="https://policies.google.com/privacy">Google</a>
        </dt>
        <dd>
          Sign-in, if you use it; and the Gemini API, if you scan a document. Nothing else on
          the site sends data to Google.
        </dd>
        <dt>
          <a href="https://resend.com/legal/privacy-policy">Resend</a>
        </dt>
        <dd>
          Delivery of account email — address confirmation and password resets. It receives your
          email address and the contents of those messages, and nothing else.
        </dd>
      </dl>

      <h2>Who else can see it</h2>
      <p>
        Your rows are readable only by your own signed-in session. This is enforced in the
        database itself through row-level security, not only in application code, so a bug in a
        page cannot expose another person&rsquo;s data. Uploaded files are held in a private
        bucket whose access policies key on your user id in the same way.
      </p>
      <p>
        We disclose personal data outside this list only where we are legally required to, and
        we will tell you if that happens unless we are prohibited from doing so.
      </p>

      <h2>Where your data is held</h2>
      <p>
        Your account and documents are stored in India, in Supabase&rsquo;s Mumbai region. The
        site itself is delivered from servers worldwide, and the sign-in and document-reading
        requests described above are processed by Google, which may handle them outside India.
        That transfer is limited to what those two features need.
      </p>

      <h2>Security</h2>
      <p>
        Traffic is served over HTTPS only. Passwords are stored as bcrypt hashes. Access to your
        rows and files is enforced by the database rather than by page logic. The document
        bucket is private, and the URLs used to upload to it are single-use and short-lived. No
        system is perfect, and we do not claim otherwise — if we discover a breach affecting
        your data we will tell you and the relevant authority.
      </p>

      <h2>How long we keep it</h2>
      <p>
        Profile, eligibility, saved items, tracker entries and preferences are kept for as long
        as your account exists. Scanned documents are kept until you delete them or delete your
        account. Delete your account and all of it goes with it. Operational logs held by our
        providers expire on their own retention schedules, which are measured in weeks rather
        than years.
      </p>

      <h2>Your rights</h2>
      <p>
        Under India&rsquo;s Digital Personal Data Protection Act, 2023, you may ask us for a
        copy of the personal data we hold about you, ask us to correct or complete it, ask us to
        erase it, and withdraw consent you have given. You can do most of it yourself,
        immediately:
      </p>
      <ul>
        <li>
          Edit or clear any profile field from <Link href="/profile">your profile</Link>, and
          turn notifications off from the same page.
        </li>
        <li>
          Delete any scanned document, file and record together, from{" "}
          <Link href="/documents">Scan a document</Link>.
        </li>
        <li>
          Revoke Google sign-in from{" "}
          <a href="https://myaccount.google.com/permissions">your Google account</a>.
        </li>
        <li>
          For a copy of everything, or to delete your account and everything attached to it,
          email <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>. We action requests
          within 30 days.
        </li>
      </ul>

      <h2>Children</h2>
      <p>
        The site is intended for people applying to government recruitment, which sets its own
        minimum ages. It is not directed at children under 13, and we do not knowingly collect
        their data. If you believe a child has given us data, write to us and we will remove it.
      </p>

      <h2>Contact and grievances</h2>
      <p>
        For any question about this policy, any request under the rights above, or any complaint
        about how your data has been handled, write to{" "}
        <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>. Your complaint will be
        acknowledged and answered within 30 days. If you are not satisfied with the outcome, you
        may raise the matter with the Data Protection Board of India.
      </p>

      <h2>Changes</h2>
      <p>
        If what we store, or who processes it, changes, this page changes with it and the date
        at the top moves. Material changes will be announced on the site rather than made
        quietly.
      </p>
    </>
  );
}
