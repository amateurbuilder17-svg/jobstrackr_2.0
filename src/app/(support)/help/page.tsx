import type { Metadata } from "next";
import Link from "next/link";

import { LEGAL_CONTACT } from "@/lib/legal/meta";

export const metadata: Metadata = {
  title: "Help and support",
  description: "How to reach JobsTrackr, what we can help with, and what we cannot.",
  alternates: { canonical: "/help" },
};

/**
 * Help and support.
 *
 * Short on purpose. A support page's job is to get someone to the right place
 * in one screen, and the old one spent most of its height on cards that led
 * back to pages the menu already lists.
 *
 * The section on what we cannot do is not a disclaimer — it is the most useful
 * part of the page. The single most common message an aggregator receives is
 * about an application, a fee or an admit card that only the recruiting body
 * can act on, and every day someone waits for us to answer that is a day they
 * are not talking to the people who can.
 */
export default function HelpPage() {
  return (
    <>
      <h1>Help and support</h1>
      <p>
        Most questions are answered on the <Link href="/faq">FAQ</Link>, and the{" "}
        <Link href="/user-manual">user manual</Link> walks through each part of the app. If
        neither covers it, write to us.
      </p>

      <h2>Getting in touch</h2>
      <dl>
        <div>
          <dt>Feedback, bugs and complaints</dt>
          <dd className="mt-1">
            The <Link href="/feedback">feedback form</Link> — it reaches us directly, and you
            can send it anonymously.
          </dd>
        </div>
        <div>
          <dt>Anything needing a reply</dt>
          <dd className="mt-1">
            <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>
          </dd>
        </div>
        <div>
          <dt>Account deletion</dt>
          <dd className="mt-1">
            Email us from the address on the account. Your profile, saved jobs and tracked exams
            are deleted with it.
          </dd>
        </div>
      </dl>

      <h2>What to include when reporting a problem</h2>
      <ul>
        <li>The job or exam it concerns — a link to the page is ideal.</li>
        <li>What you expected, and what happened instead.</li>
        <li>Your device and browser, if something looked wrong rather than read wrong.</li>
      </ul>

      <h2>What we cannot help with</h2>
      <p>
        JobsTrackr is an independent aggregator. We have no connection to any commission, board
        or department, and no access to anyone&rsquo;s application. That means we cannot:
      </p>
      <ul>
        <li>Check, correct or withdraw an application you have submitted.</li>
        <li>Issue, resend or unlock an admit card.</li>
        <li>Refund an examination fee, or tell you when one will be refunded.</li>
        <li>Change a result, a cut-off, or an exam date.</li>
      </ul>
      <p>
        All of those belong to the recruiting body, and the fastest route is the contact details
        on their official notification — which is linked from every job page here.
      </p>

      <h2>A warning worth repeating</h2>
      <p>
        We never charge for anything, never ask for a payment to apply, and never ask for your
        password or an OTP. Anyone doing so in our name is not us. Government application fees
        are paid on the recruiting body&rsquo;s own portal and nowhere else.
      </p>
    </>
  );
}
