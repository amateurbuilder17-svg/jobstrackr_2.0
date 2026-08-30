import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { CountdownCard } from "@/components/countdown/countdown-card";
import { NowProvider } from "@/components/countdown/now-provider";
import { TimerIcon } from "@/components/icons";
import { listCountdowns } from "@/lib/db/queries/countdown";

export const metadata: Metadata = {
  title: "Exam countdown",
  description:
    "Every government job application closing soon, counting down live. Sorted by what runs out first.",
  alternates: { canonical: "/countdown" },
};

/**
 * The countdown wall.
 *
 * One `NowProvider` wraps the whole list, so twenty cards share one interval
 * and one re-render per second rather than owning twenty timers between them.
 *
 * The list itself is a Server Component behind `<Suspense>`: the heading and
 * the frame prerender into the static shell, the rows stream in, and the query
 * behind them is cached and tagged so a page view does not become a database
 * read.
 */
export default function CountdownPage() {
  return (
    <div className="mx-auto w-full max-w-[68ch] px-4 py-10 sm:px-6 lg:py-14">
      <h1 className="font-cond text-3xl font-bold tracking-tight text-balance text-ink">
        Exam countdown
      </h1>
      <p className="mt-4 leading-relaxed text-ink-2">
        Every application window closing from today onwards, with the closest first. The last
        day counts down in red — a government deadline is 23:59 Indian time on the date in the
        notification, and it does not move.
      </p>

      <Suspense fallback={<WallSkeleton />}>
        <Wall />
      </Suspense>
    </div>
  );
}

async function Wall() {
  const items = await listCountdowns();

  if (items.length === 0) {
    return (
      <div className="mt-8 rounded-md border border-dashed border-line px-4 py-10 text-center">
        <TimerIcon className="mx-auto size-6 text-ink-3" />
        <p className="mt-3 font-semibold text-ink">Nothing closing right now</p>
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-ink-3">
          When a notification with an application deadline is published, it appears here.
        </p>
        <p className="mt-4">
          <Link href="/jobs" className="text-sm font-medium text-accent hover:underline">
            Browse all jobs
          </Link>
        </p>
      </div>
    );
  }

  return (
    <NowProvider>
      <ul className="mt-8 flex flex-col gap-2.5">
        {items.map((item) => (
          <CountdownCard key={item.key} item={item} />
        ))}
      </ul>
    </NowProvider>
  );
}

function WallSkeleton() {
  return (
    <ul className="mt-8 flex flex-col gap-2.5" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="h-24 rounded-md border border-line bg-surface-2" />
      ))}
    </ul>
  );
}
