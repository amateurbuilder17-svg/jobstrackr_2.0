import type { Metadata } from "next";
import { Suspense } from "react";

import { SignInRequired } from "@/components/auth/sign-in-required";
import { CalendarIcon } from "@/components/icons";
import { getUser } from "@/lib/auth/session";
import { listPersonalEvents } from "@/lib/db/queries/calendar";
import { todayInIndia } from "@/lib/format/deadline";
import { CalendarView } from "./calendar-view";

export const metadata: Metadata = {
  title: "Your calendar · Jobstrackr",
  description:
    "Every date that matters for the exams you have saved or are tracking — applications, admit cards, exam days and results, in one month view.",
  // Personal, so it leaves the index. It used to be a public page listing every
  // deadline on the site; `sitemap.ts` drops the entry to match.
  robots: { index: false, follow: false },
};

/**
 * The calendar, curated.
 *
 * It used to show every application deadline in the database — around three
 * hundred a month, all of them somebody else's. This shows the reader's own:
 * the exams they saved and the ones they track, and nothing besides. The
 * distinction is the whole feature. A month grid with thirty red dots tells you
 * that the site is busy; a month grid with four tells you what to do this week.
 *
 * The page keeps the tracker's narrow column rather than the old three-column
 * width, because the content is now the same content — a personal list of
 * exams — and the two pages sitting at different widths read as two products.
 */
export default function CalendarPage() {
  return (
    <div className="mx-auto w-full max-w-md px-4 pt-8 pb-32 sm:max-w-lg lg:max-w-xl">
      <Suspense fallback={<CalendarSkeleton />}>
        <PersonalCalendar />
      </Suspense>
    </div>
  );
}

async function PersonalCalendar() {
  // Before the first read, for the same reason as the tracker: everything below
  // belongs to one account, so there is nothing to fetch for somebody without
  // one — a guest costs a render and no queries at all.
  const user = await getUser();
  if (!user) {
    return (
      <SignInRequired
        title="Sign in to see your calendar"
        description="Every date for the exams you save or track — applications, admit cards, exam days and results — laid out month by month."
        next="/calendar"
        icon={CalendarIcon}
      />
    );
  }

  const events = await listPersonalEvents();

  return (
    <>
      <CalendarView
        events={events}
        // Resolved on the server so the month the server renders is the month
        // that hydrates. `useToday` takes over at IST midnight.
        today={todayInIndia()}
      />

      {events.length > 0 ? (
        <div className="mt-8 flex flex-col gap-2 border-t border-line pt-4">
          <a
            href="/calendar/ics"
            className="text-xs font-semibold text-accent hover:underline"
            // A download, not a navigation: without this the browser renders
            // the calendar as text in a tab on some platforms.
            download="jobstrackr.ics"
          >
            Add these dates to your calendar app (.ics)
          </a>
          <p className="text-2xs leading-relaxed text-ink-3">
            Dates marked <span aria-hidden>~</span> are expected rather than officially
            confirmed. The conducting body&rsquo;s own notice is the authority.
          </p>
        </div>
      ) : null}
    </>
  );
}

function CalendarSkeleton() {
  return (
    <div className="animate-in fade-in duration-200" aria-hidden="true">
      <div className="flex items-start justify-between gap-4 pb-5">
        <div className="space-y-2">
          <div className="skeleton h-3 w-28" />
          <div className="skeleton h-8 w-40" />
        </div>
        <div className="space-y-2">
          <div className="skeleton h-3 w-10" />
          <div className="skeleton h-4 w-14" />
        </div>
      </div>

      <div className="skeleton h-80 w-full rounded-2xl" />

      <div className="mt-3.5 flex flex-wrap gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton h-3 w-24" />
        ))}
      </div>

      <div className="mt-7 space-y-2.5">
        <div className="skeleton h-3 w-32" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="skeleton h-24 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
