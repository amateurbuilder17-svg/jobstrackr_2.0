import type { Metadata } from "next";
import Link from "next/link";

import { LEGAL_CONTACT } from "@/lib/legal/meta";

export const metadata: Metadata = {
  title: "Frequently asked questions",
  description:
    "How JobsTrackr sources government job notifications, what an account gets you, and how your data is handled.",
  alternates: { canonical: "/faq" },
};

/**
 * The questions people actually ask.
 *
 * Rewritten rather than ported. The old app's answers described a Redis cache
 * refreshing every five minutes, push notifications, a PWA install flow and
 * Telegram alerts — four things this rebuild does differently or does not have
 * yet. An FAQ that confidently describes features that are not there is worse
 * than no FAQ: it is the page someone reads *because* they could not find the
 * thing, and it tells them they are wrong.
 *
 * So every answer below is checked against what the app does today. When a
 * feature lands, its answer is added here in the same change.
 */
const FAQS: { q: string; a: string }[] = [
  {
    q: "Do I need an account?",
    a: "No. You can browse every job and every exam update as a guest, and jobs you save are kept in your browser. An account adds matching against your qualification and age, exam tracking, and a shortlist that follows you between devices.",
  },
  {
    q: "Where do the job listings come from?",
    a: "Every listing is taken from the recruiting body's own notification — the commission, board or department running that recruitment. We link to the official notification on every job page so you can check it yourself, and you should: the notification is the authority, and this site is not.",
  },
  {
    q: "How often is it updated?",
    a: "New notifications and exam updates are ingested through the day rather than on a fixed schedule, and job pages carry the date they were last changed. Deadlines and dates are the fields most worth confirming against the official notification before you act on them.",
  },
  {
    q: "Can I apply through JobsTrackr?",
    a: "No, and no site that is not the recruiting body can. Apply takes you to the official portal where the form is hosted. We never ask for an application fee, and anyone who does is not us.",
  },
  {
    q: "I found a mistake in a listing.",
    a: `Send it through the feedback form — pick "Grievance" and say which job. Errors in a date or an eligibility line are the ones worth reporting fastest, and they are fixed at the source rather than only on the page you were looking at.`,
  },
  {
    q: "What does For You match on?",
    a: "Your highest qualification, your date of birth against the post's age limits including category relaxation, your reservation category, and the sectors and states you have marked as preferred. Matching runs on the server against the published eligibility, so a post you are not eligible for does not appear rather than appearing greyed out.",
  },
  {
    q: "Is my personal data safe?",
    a: "Your profile is readable only by you — enforced in the database itself, not just in the app, so a bug in a page cannot expose another person's row. We ask for the minimum a match needs and nothing is sold or shared with recruiters.",
  },
  {
    q: "I forgot my password.",
    a: "Use the reset link on the sign-in page. If you are already signed in and want to change it, open the menu and choose Reset password — we email a link to the address on your account.",
  },
  {
    q: "How do I delete my account?",
    a: `Email ${LEGAL_CONTACT} from the address on the account and we will delete it, along with your profile, saved jobs and tracked exams. There is no waiting period and no retained copy.`,
  },
];

/**
 * `FAQPage` structured data.
 *
 * Google renders these as expandable results, which for a page like this is the
 * difference between an answer someone reads and a link someone does not click.
 * The shape is generated from the same array the page renders, so the two
 * cannot disagree — a hand-maintained second copy is how structured data ends
 * up describing an answer the page no longer gives.
 */
function faqJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map(({ q, a }) => ({
      "@type": "Question",
      name: q,
      acceptedAnswer: { "@type": "Answer", text: a },
    })),
  };
}

export default function FaqPage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Content is a literal in this file, not user input.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd()) }}
      />

      <h1>Frequently asked questions</h1>
      <p>
        If the answer you need is not here, the <Link href="/feedback">feedback form</Link>{" "}
        reaches us directly.
      </p>

      {/* A description list, not a stack of headings. These are question and
          answer pairs, and `dl` is what says so to a screen reader — which then
          announces how many there are and lets someone move between them. */}
      <dl className="!mt-8 !space-y-6">
        {FAQS.map(({ q, a }) => (
          <div key={q}>
            <dt className="text-base">{q}</dt>
            <dd className="mt-1.5 leading-relaxed text-ink-2">{a}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
