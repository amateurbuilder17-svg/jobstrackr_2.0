import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "User manual",
  description:
    "What each part of JobsTrackr does — the feed, job pages, saving, For You, exam tracking and the calendar.",
  alternates: { canonical: "/user-manual" },
};

/**
 * The user manual.
 *
 * Documents what exists today, screen by screen, in the order someone meets
 * them. The old manual was 423 lines covering eighteen features, several of
 * which the rebuild has not brought across yet; a manual describing a screen
 * you cannot open is a support ticket rather than support.
 *
 * Sections are added here as their module lands, in the same change. That rule
 * is the only thing that keeps a manual true.
 */
export default function UserManualPage() {
  return (
    <>
      <h1>User manual</h1>
      <p>
        What each part of JobsTrackr does, and what it does not. If something here does not
        match what you see, that is a bug worth <Link href="/feedback">telling us about</Link>.
      </p>

      <h2>Finding a job</h2>

      <h3>The home feed</h3>
      <p>
        Opens on what changed recently: notifications published in the last few days, deadlines
        about to pass, and exam updates. It is the page to check when you have a minute rather
        than a question.
      </p>

      <h3>Jobs</h3>
      <p>
        The full list, searchable and filterable. Search covers the post title, the recruiting
        body and the qualification; filters narrow by sector, state and qualification level.
        Both live in the address bar, so a search you want to come back to is a bookmark, and
        sending someone a filtered list is sending them a link.
      </p>

      <h3>A job page</h3>
      <p>Every job page carries, when the notification states it:</p>
      <ul>
        <li>Vacancy count, post name and pay scale.</li>
        <li>Eligibility — qualification, age limits, and category relaxations.</li>
        <li>Important dates, with the closing date shown as a countdown.</li>
        <li>Application fee by category.</li>
        <li>A link to the official notification, and to the application portal.</li>
        <li>A change log, when a date or a detail has been revised since publication.</li>
      </ul>
      <p>
        Fields the notification does not state are left out rather than guessed at. An empty
        section means the source is silent, not that the answer is nothing.
      </p>

      <h2>Keeping track</h2>

      <h3>Saving</h3>
      <p>
        The bookmark on any job card or job page adds it to <Link href="/saved">Saved</Link>. As
        a guest this is stored in your browser; sign in later and everything you saved comes
        with you. Saving works offline — the change is queued and sent when you are back on a
        connection.
      </p>

      <h3>My Exams</h3>
      <p>
        <Link href="/tracker">My Exams</Link> is for recruitment you have actually applied to.
        Add an attempt, set its stage — applied, admit card, appeared, result — and record a
        roll number and score against it. Each tracked exam can fetch its current status, which
        searches official sources and reports what it found along with where it found it. Treat
        that as a prompt to check, not as the answer: it is a summary of the web, and the
        official site is the authority.
      </p>

      <h3>Calendar</h3>
      <p>
        <Link href="/calendar">Calendar</Link> collects the dates from everything you have saved
        or tracked into one month view, and exports them as a subscribable feed your
        phone&rsquo;s calendar app can follow.
      </p>

      <h2>Matching</h2>

      <h3>Your profile</h3>
      <p>
        <Link href="/profile">Profile</Link> holds what matching needs: date of birth,
        reservation category, highest qualification, state, and the sectors you care about.
        Every field is optional and each one narrows the match, so a half-filled profile gives a
        broader list rather than no list.
      </p>

      <h3>For You</h3>
      <p>
        <Link href="/for-you">For You</Link> is the list of posts you are actually eligible for,
        scored against your profile and annotated with why each one matched. Matching runs on
        the server against the published eligibility, so a post whose age limit you have passed
        does not appear at all.
      </p>

      <h2>Updates</h2>
      <p>
        <Link href="/updates">Updates</Link> covers admit cards, results, answer keys,
        corrigenda and exam-date announcements — the things that happen after a notification is
        published. Filter by category, or search by exam name.
      </p>

      <h2>Getting around</h2>
      <p>
        On a phone, the bar at the bottom holds the five screens you use most, and the menu
        button at the top left opens everything else. The circle at the top right is your
        profile — tap it to sign in, or to open your account when you already have. On a larger
        screen, the sidebar carries the same list.
      </p>
    </>
  );
}
