import type { Metadata } from "next";

import { LEGAL_CONTACT, LEGAL_UPDATED } from "@/lib/legal/meta";

export const metadata: Metadata = {
  title: "Refund policy",
  description:
    "JobsTrackr is free to use and charges nothing. Application fees are paid to recruiting bodies, not to us.",
  alternates: { canonical: "/refund-policy" },
};

/**
 * Refund policy.
 *
 * The page exists because the URL is indexed from the old app and a 301 into
 * something unrelated is worse than an honest page. The old copy described
 * non-refundable payments; there is no payment integration in this app and
 * never was one that charged anybody, so saying so plainly is both accurate and
 * more useful than the boilerplate — the refund question people actually have
 * is about the recruiting body's application fee.
 */
export default function RefundPolicyPage() {
  return (
    <>
      <h1>Refund policy</h1>
      <p className="!mt-2 text-sm">Last updated {LEGAL_UPDATED}</p>

      <h2>JobsTrackr is free</h2>
      <p>
        There is no subscription, no paid tier and no purchase anywhere on this site. We do not
        collect card details or process payments, so there is nothing for us to refund.
      </p>

      <h2>Application fees are not paid to us</h2>
      <p>
        When you apply for a government post, the examination fee is paid to the recruiting body
        — the commission, board or department running that recruitment — through their own
        portal. We only link you to it.
      </p>
      <p>
        This matters if you are trying to get one back:{" "}
        <strong>we cannot refund an application fee, because we never received it.</strong>{" "}
        Refunds of examination fees are governed by the rules in that recruitment&rsquo;s
        official notification, and the request has to go to the body that issued it. Their
        contact details are in the notification linked from the job page.
      </p>

      <h2>If someone charged you claiming to be us</h2>
      <p>
        Nobody acting for JobsTrackr will ever ask you to pay us for a listing, an application,
        or a guaranteed result. If you have been asked to, it was not us — please tell us at{" "}
        <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a> so we can warn others.
      </p>

      <h2>If this changes</h2>
      <p>
        If JobsTrackr ever introduces something paid, this page will set out its refund terms
        before that goes live, and the date above will move.
      </p>
    </>
  );
}
