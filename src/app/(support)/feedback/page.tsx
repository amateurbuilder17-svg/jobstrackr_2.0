import type { Metadata } from "next";
import Link from "next/link";

import { FeedbackForm } from "./feedback-form";

export const metadata: Metadata = {
  title: "Feedback and grievances",
  description: "Tell us what is wrong, missing or worth adding. You can send it anonymously.",
  alternates: { canonical: "/feedback" },
};

/**
 * Feedback and grievances.
 *
 * A page rather than the modal the old app used. A modal is the wrong container
 * for something people write two paragraphs into: it cannot be linked to, it
 * cannot be returned to, and on a phone it fights the keyboard for the same
 * three hundred pixels. This one has a URL that the FAQ, the help page and the
 * menu can all point at.
 */
export default function FeedbackPage() {
  return (
    <>
      <h1>Feedback and grievances</h1>
      <p>
        Something wrong with a listing, a date that does not match the official notification, or
        a part of the app that does not work — this is where it reaches us. Suggestions are just
        as welcome.
      </p>
      <p className="!mt-3 text-sm">
        For anything only a recruiting body can act on — an application, a fee, an admit card —
        see <Link href="/help">what we can and cannot help with</Link>.
      </p>

      <FeedbackForm />
    </>
  );
}
