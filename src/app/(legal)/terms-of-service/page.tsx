import type { Metadata } from "next";
import Link from "next/link";

import { LEGAL_CONTACT, LEGAL_UPDATED } from "@/lib/legal/meta";

export const metadata: Metadata = {
  title: "Terms of service",
  description:
    "The terms you agree to when using JobsTrackr, including the limits of what we can promise about scraped notification data.",
  alternates: { canonical: "/terms-of-service" },
};

export default function TermsOfServicePage() {
  return (
    <>
      <h1>Terms of service</h1>
      <p className="!mt-2 text-sm">Last updated {LEGAL_UPDATED}</p>

      <p>
        These terms apply to jobstrackr.in. By using the site you agree to them. If you do not,
        please do not use it.
      </p>

      <h2>What JobsTrackr is</h2>
      <p>
        An independent aggregator. We collect government job notifications and exam updates that
        are already published by recruiting bodies, and present them in one place with deadlines
        and eligibility laid out. We are not affiliated with, endorsed by, or acting for any
        government department, recruitment board or public sector undertaking.
      </p>

      <h2>The accuracy of what you read here</h2>
      <p>
        This is the most important thing on this page, so it is not buried in a disclaimer at
        the bottom.
      </p>
      <p>
        Listings are gathered automatically from official sources. Automated extraction gets
        things wrong: a date can be misread, a vacancy count can be picked out of the wrong
        column, an eligibility line can be summarised too tightly. Notifications are also
        corrected, extended and withdrawn by the bodies that issue them, sometimes without
        notice.
      </p>
      <p>
        <strong>
          Before you apply, pay a fee, or rely on a deadline, confirm it against the official
          notification.
        </strong>{" "}
        Every listing links to its source for exactly that reason. We cannot be responsible for
        a missed deadline, a rejected application, or a fee paid against a listing that turned
        out to be wrong.
      </p>

      <h2>Eligibility matching</h2>
      <p>
        The For You feed filters listings against the details in your profile. It is a
        convenience, not an eligibility ruling. A job shown to you may still be one you cannot
        apply for, and a job hidden from you may be one you can. The recruiting body decides who
        is eligible; we do not.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>
          Keep your password to yourself; you are responsible for activity under your account.
        </li>
        <li>
          Give accurate details — the matching is only as good as what it is matching against.
        </li>
        <li>One account per person.</li>
        <li>
          You may delete your account at any time. We may suspend an account that is being used
          to attack, scrape or disrupt the service.
        </li>
      </ul>

      <h2>Acceptable use</h2>
      <p>Please do not:</p>
      <ul>
        <li>Scrape the site in bulk or resell its content as your own listing feed.</li>
        <li>Probe, overload or attempt to bypass the site&rsquo;s security or rate limits.</li>
        <li>Upload anything unlawful, or impersonate anyone.</li>
      </ul>

      <h2>Content and ownership</h2>
      <p>
        The underlying notifications are public documents belonging to the bodies that issued
        them. The site itself — its design, code, and the way the data is organised and
        presented — belongs to JobsTrackr. Linking to a page here is always welcome.
      </p>

      <h2>Availability</h2>
      <p>
        The service is provided as it is, without a guarantee of uptime. We may change or
        withdraw features. To the extent the law allows, we are not liable for indirect or
        consequential loss arising from using the site.
      </p>

      <h2>Privacy</h2>
      <p>
        What we store about you and why is set out in the{" "}
        <Link href="/privacy-policy">privacy policy</Link>.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of India, and the courts of India have exclusive
        jurisdiction over any dispute arising from them.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these terms: <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>.
      </p>
    </>
  );
}
